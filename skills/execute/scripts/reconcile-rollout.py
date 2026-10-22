#!/usr/bin/env python3
"""reconcile-rollout.py — deterministic vault bookkeeping for a rollout's queue (ADR 0030).

The Workflow engine (`task.workflow.js`) returns a structured result per task call, and the lead session
used to hand-edit the frontmatter transitions (status + pr + *_rounds_used). This helper performs every
one of those writes deterministically, and reads the rollout's progress back from the task notes: there
is no stored cursor (ADR 0030). A task note's `status:` plus its `started:` / `merged:` / `integrating:`
stamps ARE the rollout's state; its `ready:` stamp and `## Integration log` are the durable record of the
task's Integrations (p12-16).

Subcommands:

  reconcile   Read the workflow result JSON ({rolloutSlug, tasks:[...]}) and write each task note's
              frontmatter + its feedback section. Idempotent (safe to re-run on resume). A `review` row
              whose scope is read-only and that carries no PR is written `status: done` and stamped
              `merged:` (the first stamp wins): a read-only task is done when its review approves and
              never enters Integration. Every row removes `integrating:` (the run that produced the row
              ended any Integration). It also stamps `ready:` and appends the `## Integration log` line
              (see the Status mapping below).

  next        Which tasks start now. Given the rollout note, print one JSON object: the tasks to start and restart
              within the parallel ceiling, every held task with its reason, the running, awaiting-Integration,
              integrating and set-aside tasks, the pause state, the halt verdict and the progress line. Notes are
              re-read on every call, so a `priority:` edit reorders a live queue. Above the first queued Solo task
              whose dependencies are met, `priority:` orders; that task holds every task ranked below it, whatever
              their `priority:` (p17-2), so a `## Queue` row move, never a `priority:` edit, takes a task past it.
              Schedule order is each task's first wikilink on a list-item or table-row line of the rollout body;
              prose and fenced code never rank. Honours a soft pause: once nothing runs, awaits or integrates (a held
              RACE whose `integrating:` stands included, Race holds below), it stamps `paused:` and removes
              `pause_requested` (the drain, ADR 0030 decision 5). `startUnattended` reports the rollout start stamp
              (`start: unattended`, vault grammar § Rollout start stamp) and every call off --dry-run that gets past
              its refusals removes it (`startCleared`), so a running rollout clears it and the Chorus Stage never
              starts a second lead; a refusal leaves it. Refuses an incomplete rollout (below): exit 1, no
              stdout, one ERROR line naming why and the remedy, `/thread:schedule <its first project> --regenerate`.
              Refuses a serial rollout (`shape: serial`, ADR 0040) first, before its ceiling is read: exit 1, no
              stdout, one ERROR line, nothing written and `start:` kept: a serial rollout runs as Legs (execute
              legs.md, leg.py), never through next.
              An unacked git-env trip (Git-env hold, below) is listed as `gitEnvHold` and makes `halt` "git-env",
              ahead of every other verdict. `awaitingIntegration` is the Integration queue's order: a task a queued
              task depends on, directly or through a folded member (`merged_into:`), first, then the oldest
              `ready:`, then schedule order. Each `setAside` entry is {slug, status, setAsideAt}, plus `needsHuman`
              (p16-3: the note's `## Needs you` question, normalised) only when the note holds one. `halt` is null
              while anything starts, restarts, runs, awaits Integration or integrates; otherwise the first of
              "git-env", "paused", "empty", "complete" (or "done"), "awaiting-sign-off" and "stuck". With every
              task merged, `halt` is "complete" (run the completion ceremony), or "done" when the ceremony already
              ran through its archive move (p19-14: the rollout note reads `status: done` and sits in
              `Archive/Rollouts/`), so no entry runs it twice (the lead's `done` route runs only its last step,
              the thread close); a done note still in Work/Tasks/ is an interrupted ceremony and stays "complete".
              "awaiting-sign-off" (ADR 0034) replaces "stuck" only when every unlanded task of the rollout waits on
              a gate alone: W starts as the set-aside rows at `gate` (a race-held one reads `race`, so it never
              counts), then gains, to a fixpoint, each queued row whose every unsatisfied dependency resolves
              (_fold_unit) to a unit already in W; the verdict needs W non-empty and equal to the in-N rows not
              landed. A gate beside any other set-aside (blocked, review-blocked, plan-blocked, a RACE, an
              UNVERIFIED) stays "stuck". `awaitingSignOff` lists W in rank order, [{slug, why: "gate-pending" |
              "depends on [[<unit>]]"}], and is [] for any other verdict.
              The Trickle (Chorus ADR 0104; Trickle and Away, below): `slotLimit` (an int) and `trickle` ({away,
              file, why, limit, until, morning, elsewhere, running}) follow `slotsInUse`; every other key, `ceiling`
              included, is unchanged. Not Away, a start stops at the Trickle less the tasks running in every
              other open Rollout on the Mac and less this rollout's own in_progress tasks, live or stalled; a
              restart stops at the ceiling only. A row held there reads `trickle: <running>/<N> tasks running on
              this Mac`, and while one is, `halt` stays null. A stale or unreadable state file prints one `WARN:
              ~/.config/thread/away.json …` line on stderr, --dry-run included.

  mark-started     Stamp `started: <time>` on task notes as they start (the first start wins) and remove
              `integrating:`. The Workflow sandbox has no clock, so wall-clock enters here. It also consumes
              approve-gates' `gates_signed:` marker (p12-14): when the note carries one, it is removed and a
              second line `<slug>: signed-gate restart (gates signed <stamp>) ...` is printed, so the lead
              prints execute § 3.7's fresh-call warning only on the restart that directly follows a sign-off.
              It consumes descope's `descope_armed:` stamp the same way (p14-4): removed, with a line
              `<slug>: descope restart (descoped <stamp>; descope_armed: cleared) ...`, so a block after that
              restart reads as a second block and descope asks. It also removes hand-back's `handed_back:`
              marker (p15-2). `--start start|restart|revise|resume` names the start for the Run record (below).
              It arms the task window itself (p26-3, execute § 4.5 *Git-env canary*): `--arm-repo <repoPath>
              --arm-default <B>`, which go together (one without the other is a usage error, exit 2, before any note
              is read), are required while the task's rollout note (resolved as slot-taken resolves it: a --rollout
              whose stem is the note's `rollout:`, else <tasks-dir>/<rollout>.md) has a `Project root:` line naming a
              directory that exists (or that cannot be stat'ed), or exists but cannot be read (both fail-closed);
              missing there, the note is refused with exit 2 and nothing written, its ERROR line naming both flags.
              With no `Project root:` line, a root that does not exist or no rollout note, it behaves as before; the
              flags given with no rollout note to arm against are exit 2, nothing written. Per slug, in order: a note
              not found or unparseable, a finished status (exit 1, nothing armed), then the arm, then the writes and
              slot-taken. The arm is a subprocess, `git-env-canary.py arm --rollout <that note> --tasks-dir <dir>
              --repo <R> --default <B> --slug <slug> --kind task`, its stdout and stderr inherited (its `armed`,
              refusal and HOLD lines pass through); a non-zero arm (an OSError or a signal counts as 2) writes nothing
              for that note: no `started:`, no `integrating:` removal, no marker consumed, no slot-taken, and an
              `ERROR: <slug>: the task window's arm exited <rc>; nothing written` line. Exit 3 when any arm exited 3
              (a trip or a hold); else 2 (an arm failure or refusal, a missing or unpaired flag, the flags with no
              rollout note); else 1 (a refused note); else 0. --dry-run never runs the canary: it prints `<slug>:
              would arm the task window (dry-run)`, and the flag requirement still applies.

  mark-integrating Stamp `integrating: <time>` on a `review` note with a `pr:` as its Integration begins
              (the first wins): the durable signal /thread:status reads.

  mark-done   Flip task notes `status: review` -> `status: done`, run AFTER the task's merge is confirmed.
              Stamps `merged: <time>` on a PR task with no stamp yet and removes `integrating:`. Refuses
              any note at another status — a blocked/unmerged task can never be swept to done.
              Idempotent (already-done = no-op). Read-only tasks never need it: reconcile writes them done
              (and stamps `merged:`) on approval.

  hand-back   A set-aside task re-enters the queue at the stage it stopped (ADR 0030 decision 4; the lead's
              *Set aside* and "retry [[task]]", and /thread:repair § 4's hand-off). A `blocked` note set
              aside at Integration (its latest `## Blocker diagnosis` run starts `integration:`) with a `pr:`
              goes back to `status: review` with `ready:` restamped (it rejoins the Integration queue); a
              `blocked`, `review-blocked` or `plan-blocked` note set aside at its run, and a code-writing
              `review` note with no `pr:` (approved without a PR, which the queue sets aside at its run),
              go to `status: in_progress` with `owner:` removed and a `handed_back: <now>` marker (the next
              `next --running` restarts it, and its own call re-runs on the existing tree and branch; the
              restart's mark-started consumes the marker). Refuses (exit 1, nothing written) every
              other note: gate-pending (approve-gates' job), done, review with a PR (awaiting Integration),
              a read-only review note, in_progress, open, and a note set aside at Integration with no `pr:`.
              A task an undecided RACE or UNVERIFIED holds (Race holds, below; read on the rollout its
              `rollout:` names) is refused first, --dry-run included: exit 2, one ERROR line per held task
              naming it and `/thread:repair [[<rollout>]]`, and nothing written for any listed task.
              Feedback runs and the Integration log are never touched. The explicit re-entry (repair after
              Lachy answers, "retry [[task]]", the lead after a descope's exit 0) starts a fresh automatic-retry
              stretch (p16-4, ADR 0033): it removes `auto_retries_used` and `quota_retries_used` and re-stamps
              `auto_retry_sha` with the block it re-enters (_block_fingerprint, read before the transition;
              removed when that block has none), so an identical re-block goes straight back to a human. Its
              stdout is unchanged. Every hand-back that moves a note spends its live answers in the same save (ADR
              0035): each `## Repair input` key `(block <fp>)`, `(block <fp>; awaiting repair)` or `(block <fp>;
              left)` becomes `(block <fp>; handed back <now>)`, so no bare hand-back leaves a live answer behind (an
              identical re-block writes no run, so it would otherwise re-arm the lead's *Recorded answer*); a refused
              hand-back spends nothing. `--answer <stamp>` takes one slug (else usage, exit 2) and is a
              compare-and-swap: unless the note is set aside and its answerRecorded (`inputs`) has exactly that stamp
              and form `hand-back`, exit 1 with `ERROR: hand-back: <slug>: the answer of <stamp> is spent, superseded,
              not a hand-back answer or no longer this block's; nothing written`, so the lead and repair never both
              hand back on one answer, nor a new block on an old one.

  record-answer  Record Lachy's answer to a set-aside block (ADR 0035 decision 3; /thread:repair § 3b and § 4), the
              only writer of a `## Repair input` answer: `--tasks <slug> --rollout <note> --kind needs-you|decision
              --ask "<ask>" --answer "<answer>" --fingerprint <12hex|-> [--form hand-back|awaiting-repair|left]
              [--raise max_review_rounds|max_plan_rounds|max_iterations] [--pr <url>]`. Refuses (exit 1, nothing
              written): a note not set aside at its run, at Integration or at a gate; a --fingerprint other than the
              block's (_block_fingerprint, `-` when none); `--kind needs-you` whose --ask is not the note's question;
              `--kind decision` while the note holds a `## Needs you` question (its answer is `--kind needs-you`, which
              removes the section in the same save);
              --form missing with a fingerprint or given with `-`; `--form hand-back` when a bare hand-back would not
              move the note once saved (at Integration with no pr:, a `prUrlError` on a revise or Integration way back
              read against the Project root, a revise re-entry with no round left and no `--raise
              max_review_rounds`); --raise or --pr with `--form left`; a --raise other than the cause's
              `humanFix.raise` (lead-integrate.py cause_fix, read before the save) or `max_review_rounds` on a revise
              re-entry with no round left; an unresolvable value (the resolver's line); a re-entry stamp that does not
              parse; a stamp that, bumped, is more than one minute after now. A raise writes `lastRound + 1` for a
              revise re-entry's max_review_rounds, else the resolved value (task, rollout, rollout-settings.py) + 1,
              first as the rollout `## Notes` line `- <date> repair: [[<slug>]] <field> raised to <N>, one round` (`one
              iteration` for max_iterations) in its own save (skipped when present; its failure is exit 1 with nothing
              written to the task note). Then the task note in one save, the entry last: the `## Needs you` removal
              (needs-you), `<field>: <N>`, `pr:`, every earlier live entry for this fingerprint rewritten `(block <fp>;
              superseded <stamp>)` (a block carries at most one live answer), and the entry `- <stamp> <needs
              you|decision> (block <fp>[; awaiting repair|; left]): "<ask>" → <answer>`. The stamp is now's minute,
              bumped to one minute after the latest of the last re-entry (_last_re_entry) and every entry stamp for
              this fingerprint when now is not later, so no two entries of a block share one and none ties a
              re-entry. An identical live entry with its raise and pr: in place is `[no-change]` at its stamp. Prints
              `<slug>: answer recorded (<form>) <stamp> [written]`. Records `answer-recorded` once the task note saves
              (Run record, below); a `[no-change]` re-run, a refusal and --dry-run record nothing.

  auto-retry  Execute's automatic retry of one set-aside task (p16-4, ADR 0033; execute § 4.5 step 1.2's *Automatic
              retry*): `--tasks <slug> --rollout <note> [--auto-retries N] [--fingerprint <12 hex>]`. The task's
              `rollout:` must name --rollout (else exit 1); an undecided RACE or UNVERIFIED is exit 2 with
              hand-back's ERROR line. It then re-runs lead-integrate.py's auto_retry_verdict, the one `inputs`
              prints (its task_inputs read with the rollout's Project root as --repo, the lead's `--repo
              <repoPath>`, so the note's pr: reads as the same PR URL or `prUrlError`): an `autoRetryError` (an `auto_retries` or `max_review_rounds` stamp that is not a valid
              integer) is exit 1; --auto-retries and --fingerprint are assertions the lead copies from `inputs`,
              and a mismatch is exit 1 (the note changed since `inputs`); `autoRetry: false` is exit 1, `ERROR:
              auto-retry: <slug>: not auto-retryable: <why>; nothing written`. Otherwise it writes, in order, each
              finished by a re-run: (a) `- <stamp> auto-retry: [[<slug>]] <n>/<N> (<stage>; feedback <sha>)[;
              max_review_rounds raised to <K>, one round]` in the rollout's `## Notes` (`quota <q>/5` for a quota
              block; <stamp> is the `auto_retry_at` (b) writes; skipped when the slug's last `auto-retry:` line
              equals it but for its stamp and that stamp is later than the note's `auto_retry_at`, or the note has
              none: an earlier run's line for this same retry, whose task-note save never landed; a later retry
              that reads the same, after a hand-back reset the counters, is a line of its own); (b) the task note
              in one save: hand-back's own transition (_hand_back_note), `auto_retries_used` + 1 for an agent or
              infra block or `quota_retries_used` + 1 for a quota block, `auto_retry_sha` (the block's
              fingerprint), `auto_retry_at` (now) and, for a raise, `max_review_rounds: <K>`; (c) the events
              (Run record, below). A failed save is exit 1 with `a re-run finishes the records`: the verdict still
              holds, so the next step 1.2 finishes them. Prints `<slug>: auto-retry <n>/<N> (<stage>; feedback
              <sha>[; max_review_rounds raised to <K>]) <status>-><new> [written]` (`auto-retry quota <q>/5` for a
              quota block); --dry-run writes and records nothing. Exit 2 also on usage (more than one slug, a
              --fingerprint that is not 12 hex, a negative --auto-retries). The task note's body is never written,
              so the brief descope reads is untouched.

  log-integration  The lead's own clean-path Integration record (p12-9): append one `integrated path=lead`
              line to a `review` note with a `pr:` through _integration_log_line, from --started (the
              lead's `lead-integrate.py stamp` at the Integration's start), --anchor, --head and --base
              (40 hex each). wait = --started - `ready:`, duration = --now - --started, both in whole
              minutes (_whole_minutes, the engine's wholeMinutes); triggers `-`. A re-run of the same
              Integration (same --started and SHAs) is a no-op, even at a later --now. Changes no status,
              rounds, `rung:`, `integrating:` or `ready:`. Refuses (exit 1, nothing written) a note
              that is not `review` with a `pr:`, a SHA that is not 40 hex and a --started that is not an
              ISO stamp.

  resume      A task whose PR merged but whose note was never marked (p6-8): for each linked note that
              is not done, merged or dropped and carries `pr:`, ask gh for the PR's state and base. A PR
              MERGED into the repo's default branch flips the note to done with `merged:` from mergedAt.
              Anything else (merged into another base, OPEN, CLOSED) is reported and left alone. A task an
              undecided RACE or UNVERIFIED holds (Race holds, below) is skipped before any gh call: one
              stderr `HOLD:` line names it and `/thread:repair`, the note is untouched, and the verb exits
              3 (which takes precedence over 1; ERROR lines still print).

  status      Read-only situational scan for /thread:status. Given a rollout note, find every task note
              carrying `rollout: [[<this-rollout>]]` (glob-by-backlink — captures read-only tasks the
              `## File-sets` block omits) and emit JSON {rollout, rolloutPath, rolloutStatus, paused,
              pause_requested, pausedFor, incomplete, ceiling, ceilingError, ceilingCause, counts, progress, timeline, ladder,
              gitEnvHold, tasks}; `pausedFor` is the rollout's `paused_for` (`sign-off` under await-sign-off's
              pause, ADR 0034), else null; `ceiling` is `parallel_ceiling`, or for a note without it the operator's
              rollout settings (rollout-settings.py for the Project root: rollouts.toml, then built-in 4),
              and null with `ceilingError` the reason when it is invalid or cannot be resolved (`next`
              exits 1 on the same error; status still exits 0), else `ceilingError` is null; `ceilingCause`
              is what the error needs: `stamp` (the note's own value is invalid), `file` (rollouts.toml was
              refused), `root` (the Project root is gone or its origin unreadable) or `resolver`, else null;
              `gitEnvHold` is the unacked git-env trips (Git-env hold, below), [] when none; `incomplete`
              is why the rollout must not run as written (below), or null. `ladder` is {source, rungs (names,
              bottom first), error}: the local ladder file through ladder.py's load(); a refused file gives
              rungs [], source ladder.py's default_path() and error its reason, and status still exits 0.
              Each task carries `rung` (its `rung:` stamp, or null) and `rungDrift`: the stamp when a
              readable ladder lacks it and the task is unlanded (queued, running, awaiting-integration,
              integrating, set-aside), else "". A set-aside task whose note holds a `## Needs you`
              question also carries `needsHuman` (p16-3, normalised); no other task carries the key. A task
              set aside at Integration whose latest run opens a named marker (p27-4, integration_block) also
              carries `integrationBlock`: `conflict` (an Integration conflict, `integration: conflict
              unresolved in …`) or `red` (`integration: verifier red: …`); the key is absent otherwise. Pure
              read; no network.

  touched-phases  Read-only, for /thread:execute's completion ceremony (ADR 0026): given a rollout note,
              walk the same backlinked task notes as `status` (archived ones included) and print one
              `--project <slug> --phases <N,M,...>` line per project slug, slugs and phases sorted, for
              every task named `<slug>-p<N>-*` (N whole or fractional, `3.5`, sorted numerically: the
              vault grammar, skills/_shared/vault-grammar.md). Loose tasks are ignored; nothing linked
              prints nothing. Each line is the argument list for `reconcile-project.py <line> --kinds
              phase --apply`, so only phases this rollout touched are ever closed.

  cited       Read-only, for /thread:execute § 2.7's pushed-base scoping (ADR 0042): given a rollout note, print
              the paths its not-yet-merged tasks cite, one per line, sorted and de-duplicated. Its tasks are the
              linked ones whose queue state is queued, running, awaiting-integration, integrating or set-aside.
              It prints each `touches:` item; `docs/adr/NNNN-*.md` for every `docs/adr/NNNN` path and every
              `ADR NNNN` or `ADR-NNNN` mention; `CONTEXT.md`, or a relative `…/CONTEXT.md`, when named; and every
              `~/` path as written, a trailing `:<line>` and trailing `.,;:)`'"` stripped. Never THREAD.md. Exit
              0; exit 2 on a usage error or a missing rollout note. A clone-rooted rollout's pushed-base check
              blocks on a peer clone's ahead commits only when they touch one of these.

  fold-journals  For execute's completion ceremony and every Reflection (p15-3, ADR 0032): `--rollout <note path |
              [[slug]] | slug> [--dry-run]`. Resolves the slug with run_record.normalise_slug and never opens
              the note, so a superseded, dropped or archived rollout folds the same way. Reads the rollout's
              Run record: each `run-bound` runId (the last line for a runId wins its journalDir and call) is
              folded from `<journalDir>/<runId>.json` into one `call-journal` line through run_record.emit
              (the module's flock and dedupe; nothing else writes the record): status verbatim; mode = the
              bound call, else the journal's args.mode, else task; tokens / durationMs / agents / startTime
              from totalTokens / durationMs / agentCount / startTime, each kept only when an int >= 0 (else
              dropped with a WARN). A runId already folded with a terminal status is reported `already
              folded` before its journal is opened (journals are cleaned up after ~30 days); a fold equal to
              the runId's latest line is `unchanged`. A missing journal, an unsafe runId (a path separator
              or `..`), a relative journalDir, an unreadable or non-object journal, a journal naming another
              runId, no status, or an unparsable record line is one stderr `WARN:` line, and the fold goes
              on. Ends with `fold-journals: <slug>: N folded, M already folded, K unchanged, W warnings`.
              Exit 0 (warnings included; no record file prints `no run record at <path>`), 1 the events
              directory cannot be resolved or the record cannot be read, 2 usage, a bad slug or the reserved
              `reviews`.

  bind-run    The lead's call right after each Workflow launch returns (p15-2): `--tasks <slug> --run-id <wf_…>
              --call task|revise|integrate [--resumed-from <wf_…>] [--journal-dir <abs>]` records one `run-bound`
              (runId verbatim, journalDir, call, resumedFrom) for fold-journals. A runId (and --resumed-from) must
              match `wf_[A-Za-z0-9][A-Za-z0-9_.-]*` with no `..`: it is the journal's file stem and its `runId`.
              journalDir is --journal-dir (absolute), else `<dir>/<session id>/workflows` for the one match of
              `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/*/${CLAUDE_CODE_SESSION_ID}.jsonl`. The owner must
              hold: task or revise -> the note reads `in_progress`; integrate -> it holds the lane (_holds_lane).
              A Lost-call resume binds with the kind it resumes plus --resumed-from. A --journal-dir must hold
              `<runId>.json`, or be a `workflows/` dir whose session holds `subagents/workflows/<runId>/` (the
              run's transcript dir, made at launch; the journal lands beside the dir's other journals when the
              call ends), so the Workflow tool's printed Transcript dir is refused while the note still holds
              its state and the lead can rebind (p27-3). Exit 1 (one ERROR line, nothing written): no note, no
              `rollout:`, an unresolvable or refused journal dir (the refusal names the session's `workflows/`
              dir), a failed owner check. Exit 2: usage (a malformed runId or a relative --journal-dir).

  free-lane   `--tasks <slug>`: the lead frees the lane at the lane-free rule or a § 7 halt (p15-2). Requires
              _holds_lane (else exit 1, nothing written); closes the task's open merge hold, then records
              `lane-freed release=halt`. The note is not changed.

  hold        `--tasks <slug> --hold merge|race --state start|end` (p15-2): the lead's hold transitions. A merge
              start requires _holds_lane; a race start requires the rollout's `## Race log` to name the task
              undecided (_race_holds' RACE). Exit 1 (nothing written) when it does not. A start is skipped
              (`[no-change]`) while the record shows that (hold, task) open, an end while it does not; an end
              never checks the lane, so it is never refused. The note is not changed.

  record-pause  `--rollout <note>` (p15-2): right after a hard pause's hand stamp. Requires `paused:` (else exit
              1). Skips everything (`[no-change]`) while the record shows a pause open; otherwise records `paused
              mode=hard` (at the stamp), `slot-freed outcome=stopped` for each linked in_progress note and, for
              each lane holder, a merge-hold close and `lane-freed release=halt`. Nothing in the vault changes.

  defer       Pop task(s) out of a rollout, back to open backlog: clears `rollout:`/`owner:`, a legacy `wave:`
              and the `started:`/`merged:`/`integrating:`/`ready:`/`gates_signed:`/`descope_armed:`/`handed_back:` stamps
              and the four automatic-retry markers (`auto_retries_used`, `quota_retries_used`, `auto_retry_sha`,
              `auto_retry_at`, p16-4: a deferred task starts its next rollout afresh)
              (first-start-wins would otherwise carry a
              stale clock into the next rollout), and sets `status: open` so a future /thread:schedule
              re-plans them. The dependent-closure safety check lives in the /thread:repair skill.

  descope     An automatic descope of a plan-blocked task (p14-4), the one verb the live lead (execute § 4.5 step
              1.2) and /thread:repair § 3d share: `--tasks <slug> --rollout <note> --part "<verbatim quote>"
              (--optional --short <kebab> | --owner <slug> --owner-quote "<verbatim quote>") --reason "<line>"`.
              The caller judges that the plan-block feedback centres on the part; the verb checks it. After its state
              checks and before the part is judged: a refusal recorded for the block (_descope_refusal; a line under
              the section that does not parse fails closed) is exit 3 again, citing it and writing nothing new, an
              answer included (a later descope never overrides a refusal); then a block whose answerRecorded is
              non-null is exit 1, `ERROR: descope: <slug>: answered for this block (<stamp>); the answer stands`, with
              nothing written or recorded (the lead judged it before repair recorded the answer). Exit 3 is an ASK
              (one `ASK: [[slug]] <why>; recorded: /thread:repair [[<ro>]] asks Lachy` line) whose refusal is recorded
              (ADR 0035 decision 2): one `## Descope refused (automatic)` line on the task note, `- <stamp> descope
              refused (automatic) run=<n> sha=<12hex>, Plan-blocked feedback run <n>: "<part>" (<mode>[
              owner=<slug>]): <why>`, keyed on the top Plan-blocked run (_plan_block_key: its n and end-marker sha,
              _sha12 of its text for a legacy run with no marker), in one save and only when no line carries the key;
              a failed save still exits 3 with a stderr WARN. While `descope_armed:` stands (a descope whose hand-back
              never ran) nothing is recorded and no recorded refusal is read: the ASK line ends `; not recorded: its
              armed descope (descope_armed:) stands, so re-run it and hand it back: /thread:repair [[<ro>]]`, so that
              descope's re-run (exit 0, `[no-change]`) and hand-back stay its way back (repair § 2's **plan-blocked,
              descopable**). Exit 1 and exit 2 record nothing. Exit 3 when: the
              part, or a clause holding it, cites an ADR; a recorded decision (`## Decisions…`, a human `## Scope decision…`, a
              `## Repair input` line without `(automatic)`, `## Approved gates`, `## Gated inputs`) holds the part
              (or, for --owner, the quote); the part sits in a fenced code block of the brief (the body minus the
              record sections; a fence is never a brief item, so no pointer lands inside one); --optional and an
              occurrence of the part in the brief has no marker word (consider, considering, optional, optionally,
              nice to have) at or before it in its own clause, or the part is not in the brief (clauses split at
              `.`, `;`, `:`, `!`, `?`, a dash and `, and` / `, but` / `, then`; a marker that not / never / no
              negates is none; a clause that is only a marker ended by `:` or `.` marks the next one); --owner and
              the part is in an unmarked brief clause, or is in neither the latest Plan-blocked feedback run nor
              the brief (verbatim only: a paraphrase the feedback itself uses still passes, so the caller's
              judgement stays the guard there), or the owner is the task, not a task of this rollout, not unlanded
              and active (its queue state carried), held by a RACE or UNVERIFIED, upstream of the task, or its note
              lacks the quote; the task was descoped automatically before and restarted since (no `descope_armed:`,
              even when the new block's feedback added no run); or another part or mode at the same run. Exit 0 writes, each
              record checked and written on its own so a re-run finishes a partial one: the follow-up note
              (--optional: `<project>-followup-<short>.md`, loose, `descoped_from:`; one at that path without it is
              exit 1), then the task note in one save (a `## Scope decision (automatic)` entry and its
              `<!-- descope run=<n> part=<sha12> mode=<m> -->` marker, ` (descoped: see ## Scope decision
              (automatic))` on each brief item holding the part, or one pointer line for a part the brief lacks, a
              `## Repair input` `(automatic)` line naming the superseded Plan-blocked feedback runs, and
              `descope_armed: <now>`), then a `- <date> descope: [[slug]] ...` line in the rollout's `## Notes`.
              `[no-change]` when all are present. `status:` is never written: the caller's `hand-back` re-enters
              the task. Exit 1 (nothing written): a missing note, a note not plan-blocked at its run or without a
              Plan-blocked run, a --rollout its `rollout:` does not name, a bad --short or a follow-up name that
              reads as a phase member, a colliding follow-up, an answered block, a failed save. Exit 2: usage.

  carry       A supersede's carry (ADR 0030; /thread:schedule step 6, and § 0 finishing an interrupted
              supersede): re-point every unlanded task of the prior rollout (--from, a path) to the rollout
              that supersedes it (--to, a path). Each linked note (the notes `status` reads, root and Archive)
              is classified by its queue state: queued, running, awaiting-integration, integrating and
              set-aside ones are carried (`rollout: "[[<to>]]"` in place; `owner:`, `integrating:` and a
              legacy `wave:` removed; the automatic-retry counters `auto_retries_used` and `quota_retries_used`
              removed, `auto_retry_sha` and `auto_retry_at` kept, p16-4; its legacy stamps mapped, below; nothing
              else changes), merged, folded
              and other ones are kept. It never writes the prior note: closing it out is schedule step 7.5's.
              Legacy stamps (ADR 0029 consequences; LEGACY_KEYS: the old model, effort and cap keys): a
              carried note's non-empty `rung:` is kept, drifted or not; otherwise it gets `rung: <the
              ladder's top rung>` when its model (failing that, the --from rollout's) is `fable` or its effort
              is `xhigh` or `max` (trimmed, any case: the engine's startRung predicate). A recognised key is
              then removed: the model at fable/opus/empty, the effort at low..max/empty, the cap key at any
              value. An unrecognised value stays, with a `WARN: carry: <slug>: <key>: <value> unrecognised,
              left in place` line on stderr. The ladder (ladder.py's load()) is read only when a carried note
              needs its top rung; a refused file is a refusal (below). Prints one `carry <slug> <state>` or
              `keep <slug> <state>` line per linked note, sorted by slug, each carry line followed by
              `restamp <slug> rung=<name|kept|-> drop=<k1,k2|->` when the mapping changes the note (a rung
              added or a key removed; `kept`: its own `rung:` stays; `-`: none written and it has none; drop=
              in LEGACY_KEYS order, `-` for none), then one `order <slug>,<slug>[,…]: <clause>` line per clause
              of the --from note's own prose (fenced code skipped) that names two or more carried tasks, at
              least one queued, beside an ordering word read outside every task name (p17-2, _order_hints:
              an order kept only in prose, which schedule step 3 turns into a `depends-on:` proposal; printed
              in both modes, writing nothing; with --to and a --from still open, the tasks already on --to
              count as carried too, so § 0's interrupted finish prints them after the dying run's own carry
              moved every task; a closed re-run's --from reads only its own), then `[no-change]`, `[written: <n>]`
              or `(dry-run)`.
              --dry-run previews and needs no --to. Refuses (exit 2,
              nothing written, one ERROR line): a --from that is missing, unparseable, not tagged `rollout`,
              done or dropped (unless done with `superseded_by:` naming --to: a re-run), or neither paused
              nor never started; a --from with a task an undecided RACE or UNVERIFIED holds (--dry-run
              included; the line names each held slug and `/thread:repair [[<from>]]`); a --from with an
              unacked git-env trip (Git-env hold, below; --dry-run included; `ERROR: carry: --from <stem> holds
              an unacked git-env trip: [[a]], [[b]]: record Lachy's ack first with /thread:repair [[<stem>]]`,
              checked after the RACE hold); a carried note that
              needs the top rung when the ladder file is refused (--dry-run included; `ERROR: carry: ladder
              file refused: <path>:<line>: <reason>`, no stdout); a --to that is
              missing, not directly in the tasks dir, untagged, done or
              dropped, whose `supersedes:` does not name --from, that is --from, or that is not never
              started; no --to without --dry-run. A failed save is exit 1 at once: the prior note is still
              open, so the next unfinished-rollout check pairs the two notes as interrupted.

  verify-timeout  Read-only, for /thread:execute § 3's once-per-entry check (p14-2, p23-4): given a rollout
              note, print one JSON line {"verifyTimeout": N, "harnessTimeoutMs": 7200000, "slotWait":
              max(60, 7200 - 600 - N), "verifySlots": V, "verifySlot": {"script": <abs verify-slot.py>,
              "slots": V}} from its `verify_timeout` frontmatter (an integer
              from 1 to 6600; absent -> 1800; a quoted value or a trailing ` # comment` is read as
              `parallel_ceiling` is) and the machine's `verify_slots` (rollout-settings.py resolve(repo=None):
              rollouts.toml's [defaults], else the built-in 2; never read from the note). harnessTimeoutMs is
              the harness maximum; slotWait bounds the lead verify's wait for a verify slot, so the wait, the
              verifier and the 600 s margin fit inside it. A bad `verify_timeout`, or no note: one ERROR line on
              stderr, exit 1, no stdout (checked first). A refused rollouts.toml (the whole file is validated),
              a present one on a python with no tomllib, or a resolver that will not load: `ERROR: rollout
              settings refused: <the resolver's line>`, exit 3, no stdout.

  clear-pause Reinstate a paused rollout: remove the `paused:` stamp (and any pending
              `pause_requested`, and `paused_for`) from the rollout note. Run by /thread:execute's resume path
              when it finds a `paused:` stamp — reinstating IS plain re-invocation, so there is no separate
              resume command. Idempotent (no stamp = no-op). One refusal (ADR 0034): under `paused_for:
              sign-off`, when the queue with the pause ignored would still be awaiting sign-off (_awaits_sign_off),
              it writes nothing, prints `STILL-AWAITING: [[<slug>]]: <gate>` for each pending gate and exits 3, so
              a reinstate with a gate still unsigned never re-runs the sign-off form. Every other pause clears as
              before.

  await-sign-off  `--rollout <note>` (ADR 0034; execute § 4.5 step 5's sign-off form): the rollout finished
              everything else and only gates wait on Lachy, so it stays open, paused. Read-only check first: the
              queue with no --running and any pause ignored (_awaits_sign_off: no git-env hold, nothing running,
              awaiting Integration or integrating, no queued task free to start, and W, `next`'s
              awaiting-sign-off set, equal to the unlanded rows) must be awaiting sign-off, else exit 1 and nothing
              written. Then it stamps `paused: <now>` and `paused_for: sign-off`, appends `- <now> awaiting
              sign-off: [[a]] (gate-pending), [[b]] (depends on [[a]]): sign off, then /thread:execute
              [[<rollout>]]` under `## Pause log`, and records `paused mode=sign-off`. A note already stamped
              `paused_for: sign-off` prints `[no-change]`; another standing pause (a hard pause's `paused:`) is
              exit 1. A sign-off pause is a `paused:` like any other: never-started reads it as started, the
              primary hold releases (unfinished-rollout.py running), and the repo keeps it as its one unfinished
              rollout until signed or deferred.

  approve-gates  Sign off a gate-pending task's declared gated inputs (ADR 0008): move the bullets
              under "## Gated inputs (awaiting sign-off)" into "## Approved gates" with a sign-off
              date (gate + cap + sign-off — the durable record the engine reads via task.approvedGates
              so re-dispatches and resumes never re-ask those exact gates), remove the pending section
              (and "## Gate bounce (awaiting sign-off)", ADR 0038),
              and flip the note by the stage it stopped (p12-14), read before the flip from the
              `## Integration log`'s last line paired with the gate-pending status (p12-16): `set-aside`
              with a `pr:` is a stop at Integration -> `status: review`, `ready:` restamped from --now and
              `integrating:` removed (it rejoins the Integration queue, as hand-back's Integration arm
              does); anything else (a seeded revise's `rejected`, no log) -> `in_progress` with a
              `gates_signed: <now>` marker, where the lead's Restart routing resumes its gate-pending call
              (execute § 3.7) and the restart's mark-started consumes the marker. A `set-aside` last
              line with no `pr:` goes to in_progress with a WARN. Refuses a note that isn't
              gate-pending; idempotent once approved (already-approved note = no-op). Run by the lead
              session only after Lachy explicitly signs off.
              --standing --rollout <note> (ADR 0034): the standing approval, run by the lead unattended. It
              signs only the spend gates Lachy's recorded standing approval covers: each pending bullet is
              priced by skills/_shared/scripts/gated_inputs.py's exposure() (fail closed: credential and
              irreversible gates, and any shape it cannot price, never pass) against the limit
              `spend_approval_usd`, resolved task frontmatter -> rollout frontmatter -> rollouts.toml
              (_resolved_settings: file:repo, file:defaults) -> built-in 0, which is off (sources `task`,
              `rollout`, `file:repo`, `file:defaults`, `built-in`; _retry_budget's order). A gate is covered iff
              the limit is > 0 and its total exposure is at most the limit. Each covered gate moves to
              `## Approved gates` with gated_inputs.annotation()'s suffix, `(approved <date> under the standing
              approval: total exposure US$<x>, limit US$<t> from <source>)` (GATE_ANNOT_RE strips it), deduped by
              _norm_gate, and prints `<slug>: gate approved under the standing approval: <gate> (exposure US$<x>
              of US$<t>, <source>)`. Once nothing is pending the note flips by its stage exactly as above;
              otherwise the remaining bullets stay pending (rewritten without the covered ones) and the note
              stays gate-pending. Each remaining gate prints `ASK: <slug>: <gate>: <why>` (with a built-in
              limit, a priceable gate's why is `standing approval off (built-in 0): set [defaults]
              spend_approval_usd in ~/.config/thread/rollouts.toml`). A note carrying "## Gate bounce (awaiting
              sign-off)" (ADR 0038: the plan judge bounced its plan, reconcile wrote the section) has nothing
              covered, whatever its gates price: each gate is an ASK whose why starts `the plan judge bounced
              this plan (ADR 0038; …)` and ends with the pricer's reading, and nothing is written (exit 3). Lachy's
              sign-off removes the section with the pending one. Exit 0: every gate covered and written;
              3: some or none covered (the covered ones written, an ASK line for each of the rest; a re-run on
              gates already judged writes nothing and exits 3); 1: an error, nothing written for that slug (a
              missing note, a task whose `rollout:` is not --rollout, a note that is not gate-pending with
              pending gates, a `spend_approval_usd` stamp that is not an integer >= 0, rollout settings refused).
              --standing without --rollout is exit 1 (`ERROR: --standing needs --rollout`), nothing written. A
              note already fully approved stays `[no-change]`, exit 0.

  gate-pricer  Read-only (ADR 0038; execute § 4's *Resolve `gatePricer`*): `--tasks <slugs> --rollout <note>`. For
              each task it resolves the standing approval's limit exactly as approve-gates --standing does
              (_standing_limit: task, rollout, rollouts.toml, built-in 0) and prints one JSON line, {"slug",
              "gatePricer", "limit", "source", "why"}: gatePricer is the absolute path of
              skills/_shared/scripts/gated_inputs.py when the limit is > 0, else "" with why `standing approval off
              (<source> 0)` (why is "" when on). The lead passes a non-empty gatePricer as the task call's
              args.gatePricer, and the plan judge then prices each spend gate through `exposure -`. Exit 1, with an
              `ERROR:` line on stderr and no line for that slug, on a missing note, a task whose `rollout:` is not
              --rollout, a `spend_approval_usd` stamp that is not an integer >= 0, refused rollout settings or a
              missing gated_inputs.py; the lead then omits the key. It writes nothing and records no Run-record
              event.

Run record (p15-2, ADR 0032): each verb records its own Slot and lane transitions, and (p21-2) the human acts it
carries out (a Recorded answer, a sign-off, a hand-back, a consumed RACE decision), through run_record.py's
emit (one helper, _event), best-effort: a refusal or a write failure prints one `run_record:` line on stderr
and never changes the verb's exit, stdout or vault writes. Nothing is recorded on --dry-run, by a refusal, or
for a note with no `rollout:` (the rollout slug is the task note's `rollout:`, read before any write; `next`,
`record-pause`, `clear-pause` and `await-sign-off` use the rollout path's stem). Most re-runs that write nothing new record
nothing, but not all: mark-integrating records `lane-taken` on every successful call and a re-run of
mark-started records `slot-taken` again; run_record.py's reader rules absorb those repeats (the same holding,
the same Slot keeping its first `start`). A
note holds the lane (_holds_lane) when it reads `review` with a `pr:` and either carries `integrating:` or its
`## Integration log`'s last line is `integrated` with a startedAt at or after `ready:` (the window between an
integrate call's reconciled `integrated` row and the merge; a hand-back restamps `ready:`). The events:
  mark-started      slot-taken {settings, start, carriedFrom?}. settings: parallel_ceiling (the rollout note's,
                    _ceiling), max_review_rounds / max_iterations / max_plan_rounds (task fm, then rollout fm,
                    then rollout-settings.py once per process; ints >= 1 kept; max_iterations 1 for a
                    read-only task with no stamp), rung (a rung name). start, first match: --start resume;
                    a `handed_back:`, `gates_signed:` or `descope_armed:` marker -> hand-back; --start
                    revise|restart|start; `started:` present -> restart; else start. carriedFrom: the
                    record's unconsumed `carried` line for the task. No resolvable ceiling (or no rollout
                    note): one `run_record: warning: slot-taken for <slug> not recorded: <why>` line.
  mark-integrating  lane-taken, on every successful call.
  mark-done         (a note not already done) hold-ended race / merge for each the record shows open; then,
                    when it held the lane, lane-freed release=merge with path, triggers and conflict from
                    the Integration log's last line when it is the current Integration's (startedAt at or
                    after `ready:`; otherwise left out); then merged pr=.
  resume            the same events as mark-done, for each note it flips done; a note that read `in_progress`
                    first records slot-freed outcome=completed (its PR merged, so its Slot ends there). A note a
                    decided RACE or UNVERIFIED marks first records race-decided {mark, by=resume} (p21-2: Lachy's
                    decision landed it; once per task). mark-done never does: a green re-verify lands the task with
                    no decision consumed.
  reconcile         per row, against the note's status and _holds_lane before the row's writes: slot-freed
                    when it was in_progress and the row is not an integrate row (outcome ready, completed,
                    lost for a lead row whose reason starts `workflow call failed:`, else set-aside); ready
                    pr= when `ready:` is stamped; merged readOnly=true for a read-only approval; when it
                    held the lane and the row is not an `integrated` integrate row, a merge-hold close and
                    lane-freed (reject for a `rejected` integrate row, else set-aside; path, triggers and
                    conflict from the integrate row; a lead row carries no integration, so only an
                    Integration log line from the current Integration, its startedAt at or after `ready:`
                    and read before the row, supplies them, and otherwise they are left out: a prepare
                    set-aside or a dead integrate call writes no line of its own); set-aside {stage,
                    reasonClass, setAsideAt} when the row sets a slot or lane holder aside (never a rejected
                    integrate row that leaves the note `blocked`: its seeded revise follows, so it is not a
                    set-aside; a rejected row that ends review-blocked is one); quota-stall {stage, detail}
                    for a `workflow call failed:` lead row whose error line reads as a usage or rate limit
                    (QUOTA_RE); then (p21-3) review-verdict {round, verdict, findings, original, regression,
                    digest, head?} per reviewVerdicts entry of a row that was in_progress and carries no
                    integration (the row-field mapping's reviewVerdicts, below), written once per verdict_key.
  hand-back         (p21-2) race-decided {mark, by=hand-back} when a `RACE decided:` line lifted the task's hold
                    (_record_decision: once per task per record); then handed-back {via, arm}: via, first match,
                    descope (a `descope_armed:` stamp standing, read before the transition), answer (--answer, a live
                    answer of any block spent by this save, or a `(block -)` entry newer than _last_re_entry: not
                    this block's answer only, so it can skew a Reflection's act tally by kind, never its per-task
                    rate), else retry; arm run | integration. Then the Integration arm records ready pr=; the run
                    arm stamps `handed_back:`.
  record-answer     (p21-2) answer-recorded {answerKind: --kind, form?: --form, raise?: --raise, pr: --pr given},
                    after the task note saves.
  auto-retry        race-decided {mark, by=auto-retry} when a `RACE decided:` line lifted the hold (once per task;
                    p21-2, no handed-back: the retry's own event names it), hand-back's own events (the
                    Integration arm's ready pr=), then auto-retry {stage, setAsideAt,
                    retryClass, used, budget, fingerprint, reviewRounds?, quotaRetries?} (p16-4): stage is the
                    task's latest set-aside line's in the record (exact pairing for a Reflection), else the stage table
                    below over the note (_retry_stage); setAsideAt run | integration; retryClass agent | infra |
                    quota; used is auto_retries_used after the retry (a quota retry leaves it); budget the resolved
                    auto_retries; reviewRounds the raised max_review_rounds; quotaRetries quota_retries_used after a
                    quota retry.
  approve-gates     (p21-2) gate-signed {standing: false, gates: the count signed} for each note it signs (Lachy's
                    sign-off), --standing gate-signed {standing: true, gates: the count covered} when it covered any
                    (the Standing approval's, never counted as his act); then the Integration arm records ready pr=.
  defer             (read before clearing) slot-freed outcome=stopped for an in_progress note; for a lane
                    holder a merge-hold close and lane-freed release=halt; an open race hold closes.
  carry             to the --from rollout, after each carried note saves: slot-freed stopped for a running
                    note, a merge-hold close and lane-freed halt for a lane holder; then carried {from, to}
                    (the writer appends it to both files).
  next              (not --dry-run) paused mode=soft when it stamps `paused:`; idle-slots {reason, free,
                    settings} when free = ceiling - (slotsInUse + starts) > 0 and halt is not complete,
                    done or empty (free stays the ceiling's, never the Trickle's).
  clear-pause       when it removes `paused:`: paused mode=hard at the stamp when the record has no open pause
                    (a hard pause whose record-pause never ran), then resumed. Removing only
                    pause_requested records nothing; a refusal (STILL-AWAITING) records nothing.
  await-sign-off    paused mode=sign-off when it stamps, unless the record shows a pause open.
  bind-run, free-lane, hold, record-pause   above.
  git-env-canary.py hold-started / hold-ended hold=git-env (task null) on the hold's empty <-> non-empty edge.
set-aside stage, first match (auto-retry's stage too, when the record holds no set-aside line for the task: the lead
kind read off the note by _note_reason, failed a `workflow call failed:` reason, prior `review` for a `merge-task`
reason, an integrate row for a review-blocked note whose current Integration log line is `rejected`): gate-pending ->
gate; an integrate row (review-blocked included) -> integrate; lead kind integration -> integrate; lead kind own
on a note that read review (merge-task exit 1) -> integrate; lead kind revise-stopped -> review; a dead own call ->
implement; plan-blocked -> plan; review-blocked -> review; an engine-blocked revise marker -> review; other
engine-blocked -> implement; review with no PR -> review. `verify` is unused here. stage is where the task stopped;
setAsideAt (_queue_state's run | integration | gate) is where it re-enters, so merge-task's exit 1 reads stage
integrate, setAsideAt run.
reasonClass, first match: quota; call-failed (`workflow call failed:` with the note in_progress before, or the
integration kind); merge-task (a reason starting `merge-task`, and exit 4's `base moved` / `head moved after
Integration`); declined; prepare (any other lead integration reason); revise-stopped; transient (the engine's
TRANSIENT_DIAGNOSIS); then gate (gate-pending); needs-human (p16-3: the row's own needsHuman is a non-empty
string, never the note's `## Needs you`, so an integrate or lead row, which carries null, never reads it; a
question is no round run out, so it must not reach plan-rejected or review-rounds, the classes the Reflection raises
a round cap on); then by status: plan-rejected, review-rounds, approved-without-pr (review with no PR), then an
integrate row's set-aside by its diagnosis's first line (integration_block, p27-4): integration-conflict (an
Integration conflict, `integration: conflict unresolved in …`), integration-red (`integration: verifier red: …`),
else integration-set-aside; else blocked.
idle-slots reason, first match ("queued" is queued and not starting this call): gitEnvHold -> hold-git-env;
paused or pauseRequested -> pause-drain; any `trickle:` hold (only ever a queued row: a stalled row waits on the
ceiling alone) -> hold-trickle; the first held queued row's reason: `depends on` -> dependency,
solo or behind solo -> solo; no queued row and a RACE in raceHold -> hold-race; no queued row and a set-aside
row -> awaiting-hand-back (a known mislabel when every one is a blocked row step 1.2 relaunches as a seeded
revise: its slot-taken start=revise splits the span seconds later; also while step 1.2's automatic retry waits out
a quota or infra cool-down, p16-4, since `next` never reads the retry verdict: the task's auto-retry event ends
that span); else queue-tail. `next` never records hold-merge: a merge hold is lead state, recorded by `hold`.
Departures from the p15-2 brief: no ceiling-changed (the writer refuses it; the settings on every slot-taken
and idle-slots carry the ceiling); log-integration records nothing (the lane is held through the merge, ADR
0030; its path and triggers ride on mark-done's lane-freed release=merge); merge-task.sh records nothing (its
positional args name neither rollout nor task, and `merged` has one writer per landing: the vault flip to
done).

Stdlib only. Frontmatter is edited line-surgically (not via a YAML round-trip) to preserve field order,
comments, and spacing exactly — matching how the rest of the vault tooling treats frontmatter. Importing
this module has no side effects: reconcile-project.py loads `Note` from it.

Queue states (one per linked task, re-read on every call):
  done                                        -> merged
  review + pr:                                -> integrating (with `integrating:`), else awaiting-integration
  review, no pr:, scope read-only             -> merged (a legacy read-only approval)
  review, no pr:, any other scope             -> set-aside ("approved without a PR")
  in_progress                                 -> running
  open / no status                            -> queued
  review-blocked, blocked, plan-blocked,
  gate-pending                                -> set-aside; setAsideAt `integration` when blocked and the
                                                 latest `## Blocker diagnosis` run starts `integration:`,
                                                 `gate` for gate-pending, otherwise `run`
  merged (an affine tombstone)                -> folded, outside N
  anything else (dropped, parked)             -> other, outside N
  an undecided RACE / UNVERIFIED (next only)  -> set-aside at race (Race holds, below)

Race holds (_race_holds; _race_marks keeps the decided ones too; read by `resume`, `next`, `carry`, `hand-back` and
`auto-retry`; status § 3's definitions): RACE is a linked note not done, merged or dropped whose slug a wikilink
names on a line of the rollout's `## Race log` (any alias, heading or escaped pipe; any case). UNVERIFIED is a set-aside note whose latest run
(`blockerSummary`) carries `UNVERIFIED:`. RACE wins when both apply. Either is lifted only by a line in the
rollout's `## Notes` section matching `repair: [[<slug>]] RACE decided:` (an alias allowed, any case): main
holds a combination nobody verified, and only Lachy's recorded decision releases it. `next` re-reads a held
task that has not landed as set-aside at `race` (so it never starts, restarts or integrates, and its
dependants wait) and lists it under `raceHold`; one whose `integrating:` stamp stands (the lead's RACE
re-verify holds the lane) still counts as integrating for the pause drain, the solo rule, the overlap and the
halt verdict. `hand-back` refuses a held task (exit 2, nothing written). `status` reports the stored state,
which status § 3 renders as a RACE itself. A verb that moves a task because its decision lifted the hold (`resume`
lands it, `hand-back` or `auto-retry` re-enters it) records that once, `race-decided` (_record_decision, p21-2): the
human act a Reflection counts. The hold itself, opened on every merge-task exit 5 and ended by a green re-verify's
mark-done, is no act. `defer` and `mark-done` never read the decision.

Git-env hold (_git_env_hold, read by `next`, `status`, `carry` and skills/execute/scripts/git-env-canary.py;
execute § 4.5 *Git-env canary*): the rollout note's `## Git-env log` (GIT_ENV_LOG_SECTION) holds one line per
tripped window, `- <stamp> git-env trip [[<slug>]] <kind>: <what changed>; repo <R>` (GIT_ENV_TRIP_MARK), written
by the canary when the shared checkout's `refs/heads/<default>` or its bareness changed during a window, and one
line per human ack, `- <stamp> git-env ack [[a]], [[b]]: refs/heads/<B> at <sha|absent>, core.bare false`
(GIT_ENV_ACK_MARK), written only by the canary's `ack` (through /thread:repair). The hold is every trip line that
no later ack line names (its wikilinks, read with WIKILINK_OPEN_RE), in log order, as {slug, kind, line}. While it
is non-empty `next` starts and restarts nothing, holds every stalled or queued task with the reason
`git-env hold: /thread:repair` and reports `halt: "git-env"` ahead of every other verdict; `status` reports it as
`gitEnvHold`; and `carry` refuses the prior (exit 2, --dry-run included) with an ERROR line naming each held slug
and `/thread:repair [[<from>]]`. A `## Race log` line carrying `git-env halt` names its slug like any Race log line,
so once the hold is acked the RACE hold applies unchanged.

Trickle and Away (Chorus ADR 0104 d2, d3, d6; the spec is skills/execute/away.md): `next` reads the Away state file,
~/.config/thread/away.json under the home dir at call time (AWAY_FILE_REL), as one JSON object of AWAY_KEYS (_away_state).
Missing (no file, a dangling symlink, a plain file in its directory's place), unreadable (any other OSError, over 64 KiB,
not UTF-8, not JSON, not an object, a key missing or ill-typed) or stale (`until` <= now, `written_at` over 24 h old or
more than 5 minutes ahead) reads not Away at DEFAULT_TRICKLE, the file's own `trickle` ignored; stale and unreadable
print the AWAY_WARN line. Fresh, `away` and `trickle` are the file's. The count elsewhere (_elsewhere_running) is one
walk of --tasks-dir, _scan's index: each other rollout note directly in it, tagged `rollout`, not done or dropped,
parallel, with no `paused:` stamp and started (never_started), counts its `status: in_progress` notes less the ones
its own undecided RACE or UNVERIFIED holds. Serial rollouts, review and integrating notes never count. This rollout's
own use is counted the same way, every in_progress row of its own, live or stalled, so a new start fits only while
elsewhere + its own in_progress + this call's starts < the Trickle; a restart waits on the ceiling alone (no state leaves
two respawned leads each waiting on the other's stalled notes). `next` never writes the file.

Never started (never_started, read by `carry` and skills/_shared/scripts/unfinished-rollout.py): no execute
session has run the rollout. Only execute's own marks count. On the rollout note: `paused:`, a truthy
`pause_requested`, `completed:`, or a `## Pause log`, `## Completion log` or `## Leg log` (a serial rollout's Legs,
leg.py) heading line. On a linked task note:
a non-empty `owner:` or `integrating:`. A task's status and its `started:` / `ready:` / `merged:` stamps never
count, because a carry keeps them. A protocol-3 run shows through the `owner:` its engine stamped on each task
at dispatch.

Incomplete (incomplete, read by `next`, `status` and unfinished-rollout.py): a never-started rollout that must
not run as written. The first that applies:
  - it carries `incomplete: true`. Every rollout note is born with it (the schedule template, written at
    step 6, or the serial template at § Serial path S5), and step 7's (S6's) last write removes it once every
    task is stamped, so a /thread:schedule run that stopped anywhere in between leaves it. Schedule § 0 also
    stamps it on the note an interrupted supersede wrote; that stamp ends only when a later supersede closes
    the note, and one left on a serial note, which a supersede never takes, ends only by `status: dropped`;
  - its `supersedes:` names a rollout still unfinished beside it (not done or dropped): the supersede has
    not closed that one out (schedule step 7.5), which is what ends this reason.
Neither reason reads the task notes' links, so a task taken out of a rollout (repair's `defer`, a gate
dropped after step 7, with or without its `## Queue` row) never makes it incomplete. And neither can newly
apply to a rollout that has run, even once every task that marked it started is deferred and it reads as
never started again: `next` never started it while it carried the stamp or while its `supersedes:` target
was open (a closed target stays closed: step 7.5 files it in Archive/Rollouts/), and § 0 stamps only a note
it pairs with an open prior.

Status mapping (workflow status -> note writes), per execute/SKILL.md §6:
  review         -> status: review;        pr: <url>; review_rounds_used: <n>; plan_rounds_used: <n> (if >0);
                    read-only with no PR -> status: done instead;
                    `ready: <stamp>` (overwriting any earlier one) on a move to review from another status,
                    non-read-only, and NOT for a row carrying `integration`: readyAt is when the approving
                    own (or seeded revise) call returned, per the engine header. A set-aside re-entry is
                    leaving Integration, not joining the queue. A re-reconcile (review -> review) never
                    re-stamps;
                    when approvedAtCeiling: a run of reviewHistory (grouped by round) under
                    "## Review history (approved at ceiling)" — ceiling approvals stay auditable
  review-blocked -> status: review-blocked; pr: <url>; a run of reviewHistory (grouped by round; legacy
                    results without it fall back to final-round reviewFeedback) under "## Review-blocked feedback"
  blocked        -> status: blocked;        a run of blockerDiagnosis under "## Blocker diagnosis"
  plan-blocked   -> status: plan-blocked;   a run of blockerDiagnosis under "## Plan-blocked feedback"
  gate-pending   -> status: gate-pending;   UPSERT gatedInputs under "## Gated inputs (awaiting sign-off)"
                    (upsert, not append: a refreshed declaration replaces the pending list, never stales);
                    when blockerDiagnosis holds the plan judge's bounce paragraph (ADR 0038: one opening with
                    `bounced by the plan judge (ADR 0038):`), UPSERT that paragraph, to its end, under
                    "## Gate bounce (awaiting sign-off)"
  gate bounce    -> (any status) a row that is not gate-pending, or a gate-pending row with no bounce paragraph,
                    removes "## Gate bounce (awaiting sign-off)"; approve-gates' sign-off removes it too
  integration    -> (any status; a mode-'integrate' row's `integration` object) one bare line under
                    "## Integration log", exactly 10 space-separated tokens:
                      <startedAt> <outcome> path=<p> pr=<n> anchor=<sha> head=<sha> base=<sha> wait=<n|->
                      duration=<n|-> triggers=<list|->
                    from metrics.startedAt (verbatim), outcome, path, the row's prUrl (its PR number; `pr=-`
                    when missing, empty or neither a GitHub PR URL nor `#7`/`7`), anchor.headSha, headSha,
                    baseSha (full SHAs), metrics.waitMinutes / durationMinutes (ints) and triggers
                    (comma-joined, in order). `-` stands for a missing value (None, '', [], a non-int minute
                    count); whitespace inside a value becomes `_`. Dedupe: a line whose startedAt is set is
                    skipped if an identical line appears anywhere in the section; a line whose startedAt is
                    `-` is skipped only if it equals the section's last non-blank line. So a re-reconcile is
                    byte-identical, and with startedAt so is a replay of an older row (two Integrations of
                    one task started in the same minute with identical fields would collapse: negligible).
                    Until the lead passes startedAt, lines are told apart only by position: S, I, S' keeps
                    three lines, back-to-back identical lines collapse to one. Readers take the LAST line.
                    `integration: null` counts as absent; a non-object is an error (exit 1, no line).
  rung           -> (any status; ADR 0029 decision 7) `rung: <name>`, the rung the task reached, when the row's
                    `rung` is a non-empty rung name ([a-z][a-z0-9._-]*, never a YAML word), so a re-dispatch
                    starts there. A malformed name is an error (exit 1) and stamps nothing. An empty `rung`
                    (an integrate row passing a neutral record through, a lead-written row with none)
                    stamps nothing. Reconcile never writes a legacy stamp and never removes `rung:`; stale
                    legacy stamps (the old model, effort and cap keys) are left for a supersede's `carry`,
                    which maps them to a rung (schedule § 0).
                    A pre-3.0.0 row (no `rung`; a call started on the tier engine that finished there, e.g.
                    a Lost-call resume of its old scriptPath) with `escalated` or `tierCapped` true proved
                    the task non-mechanical: it stamps `rung: <the ladder's top rung>` (ladder.py's load(),
                    the file each call reads) and prints a WARNING naming the slug. When the ladder cannot be
                    read that is an error (exit 1) and nothing is stamped. Any other legacy row stamps nothing.
  plan           -> (any status; p14-2) the row's approved plan, settled only by the task's own call: a non-empty
                    string upserts "## Approved plan" (a lead-in line marking it a non-authoritative record,
                    then the plan as a `> ` quote, CRLF -> LF; approved_plan() reads it back for
                    `lead-integrate.py plan`, the seeded revise's, and the integrator reads it from the note
                    itself, p27-1); '' or whitespace removes that section; null or no key leaves it. Anything
                    else is an error (exit 1) and leaves the section; the rest of the row is still written.
  needsHuman     -> (any status; p16-3) the question a person must answer, which the engine row carries when a
                    judge, implementer, investigator or reviser stopped on one: a non-empty string upserts
                    "## Needs you" (the question, stripped and neutralised like a gate-pending section, so a
                    `## ` line in it never splits the section); '' or whitespace removes it (an own-call row
                    with no question settles an older one); null or no key leaves it (an integrate row, a
                    lead-written set-aside row). Anything else is an error (exit 1) and leaves the section;
                    the rest of the row is still written. needs_human() reads it back, normalised, for `next`,
                    `status` and lead-integrate.py.
  reviewVerdicts -> (Run record only; task-mode rows; p21-3) one review-verdict event per entry, its head resolved in
                    the task tree, written once per verdict_key; Integration re-reviews write none. Each entry is a
                    master-review round the call judged, {round, verdict, head, feedback}: its head (7-40 hex, else
                    dropped with a `run_record: warning:` line and never given to git) is resolved to a full sha in
                    the row's worktreePath (review-split.py resolve; kept as given when the tree cannot), and the
                    event is skipped when the record already holds its run_record.verdict_key ((task, round, head),
                    else (task, round, digest)), so a signed-gate or Lost-call resume's replayed rounds are written
                    once. A `changes` round's bullets are split original / regression by review-split.py: each
                    bullet's first `path:line` blamed at the head, a regression when the blamed commit is in
                    first-parent baseline..head, the baseline the task's first judged head (the record's earlier
                    heads, then this row's, the first that is an ancestor of the head); no cite, no tree or no blame
                    leaves a finding unclassified (in findings, in neither count). An approve is 0/0/0. Written only
                    for a row that ends a Slot (the note read in_progress) and carries no `integration`; nothing for
                    a row without the key (a pre-p21-3 engine's, a lead-written one) or on --dry-run; a non-list
                    or a malformed entry is one warning. Never changes the exit, stdout or vault writes.

Accumulated feedback (p6-4): the run sections keep every run, never only the first. Each run is a block

  ### Run <n> (<stamp>)

  <content>

  <!-- run <n> end sha=<12 hex> -->

where sha is the sha256 of the normalised content (lines right-stripped, outer blank lines dropped, runs
of blank lines collapsed). The content is written neutralised: a heading at level 1-3 in it is pushed
three levels down and a run-end-shaped line is indented, so feedback text can never end its section or
open or close a run (the sha stays over the content as given). See Note.append_run for the rules; nothing
already written is ever deleted.
"""

import argparse
import fnmatch
import hashlib
import importlib.util
import json
import math
import os
import re
import stat
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

DEFAULT_TASKS_DIR = Path(os.path.expanduser("~/repos/obsidian/Work/Tasks"))

# Which workflow statuses carry a PR to record.
STATUS_WITH_PR = {"review", "review-blocked"}

# Per-status body section a run of feedback is written under.
BLOCKED_SECTIONS = {
    "review-blocked": "## Review-blocked feedback",
    "blocked": "## Blocker diagnosis",
    "plan-blocked": "## Plan-blocked feedback",
}

# Gated inputs (ADR 0008): a task the engine stopped for sign-off of declared gates (Lachy's, or for a covered spend
# gate the standing approval's, ADR 0034). Deliberately NOT in BLOCKED_SECTIONS: `next` never starts or restarts one,
# and only approve-gates makes it startable again.
GATE_PENDING_STATUS = "gate-pending"
GATE_PENDING_SECTION = "## Gated inputs (awaiting sign-off)"
APPROVED_GATES_SECTION = "## Approved gates"
# The plan judge's bounce (ADR 0038): a gate-pending row whose blockerDiagnosis holds the engine's bounceNote paragraph
# (it opens a paragraph with GATE_BOUNCE_MARK, task.workflow.js's BOUNCE_MARK) went to sign-off on a plan the judge
# did NOT approve, over spend gates it read as unpriceable. Reconcile writes that paragraph, to its end, under
# GATE_BOUNCE_SECTION (the flagged gates and the judge's feedback, for the person who signs) and removes the section on
# any other row. While it stands, approve-gates --standing signs nothing on the note (_approve_standing: every pending
# gate is an ASK naming it), so a gate the judge flagged is never signed unattended, even one it wrongly called
# unpriceable; Lachy's sign-off (_sign_route) removes it.
GATE_BOUNCE_SECTION = "## Gate bounce (awaiting sign-off)"
GATE_BOUNCE_MARK = "bounced by the plan judge (ADR 0038):"
GATE_BOUNCE_RE = re.compile(r"(?:\A|\n\n)(" + re.escape(GATE_BOUNCE_MARK) + r".*)\Z", re.S)
# approve-gates' marker on a signed task sent back to in_progress (p12-14): the restart that directly follows
# the sign-off reads it through mark-started, which removes it (execute § 3.7's fresh-call warning).
GATES_SIGNED_KEY = "gates_signed"
# The standing approval (ADR 0034): its limit, `spend_approval_usd` (task frontmatter, rollout frontmatter, then
# rollouts.toml through rollout-settings.py), and the rollout's sign-off pause, `paused_for: sign-off` beside `paused:`
# (await-sign-off writes both; clear-pause removes both).
SPEND_APPROVAL_KEY = "spend_approval_usd"
PAUSED_FOR_KEY = "paused_for"
SIGN_OFF = "sign-off"
PAUSE_LOG_SECTION = "## Pause log"
# The rollout start stamp (p23-6; skills/_shared/vault-grammar.md § Rollout start stamp): the execute offer's
# Start when ready writes a top-level `start: unattended`, the Chorus Stage reads it (the first `start:` line, scalar
# lower-cased) and starts one lead once the note is runnable, and `next` reports it and, past its refusals and off
# --dry-run, removes it, so the Stage never starts a second lead. Chorus's record, `started_unattended:`, is untouched.
START_KEY = "start"
START_UNATTENDED = "unattended"

# Review-loop memory (2026-08-14): an approval on the FINAL review round with real rejection history
# (engine flag approvedAtCeiling) persists the accumulated by-round rationale. An AUDIT RECORD, not an
# instruction: deliberately absent from the engine's PRIOR_FEEDBACK_NOTE authoritative-sections list.
# Accumulated per run, like the blocked sections: an Integration rejection can produce a second
# ceiling approval for the same task.
REVIEW_HISTORY_SECTION = "## Review history (approved at ceiling)"

# The durable record of every Integration call (p12-16): one line per mode-'integrate' row, read by the
# lead's clean path, the review-blocked resume and the gate-stop stage rule (see _integration_log_line).
INTEGRATION_LOG_SECTION = "## Integration log"

# The approved plan (p14-2): the plan-gate's approved plan, carried from the task's own call to Integration and
# a seeded revise through the note. A RECORD, not an instruction: the lead-in says so to any agent that reads
# the note, and the plan is stored as a `> ` quote so no line of it can end the section or open or close a
# run. Written by reconcile from the row's `plan` (a non-empty string upserts, '' removes, null leaves it);
# read back by approved_plan() for `lead-integrate.py plan` (the seeded revise's resume.plan), and read directly
# from the note by the integrator, whose integrate call carries no plan (p27-1).
APPROVED_PLAN_SECTION = "## Approved plan"
APPROVED_PLAN_LEAD_IN = ("The last approved plan, kept as a record for Integration. Not authoritative: a plan in "
                         "your prompt supersedes it; with no plan in your prompt, the brief is the contract.")

# The question a person must answer (p16-3): the engine row's `needsHuman`, the exact question a plan judge,
# review judge, implementer, investigator or reviser stopped on. Written by reconcile from the row (a non-empty
# string upserts, '' removes, null leaves it, like the approved plan); read back by needs_human() for `next` and
# `status` (each set-aside entry) and lead-integrate.py's inputs. A record section, never brief text.
NEEDS_HUMAN_SECTION = "## Needs you"

# The lead's Integration verify timeout (p14-2, execute § 3): rollout frontmatter `verify_timeout`, seconds.
# The harness bound on the background command is the harness maximum, 7200000 ms (HARNESS_MAX_S); inside it fit
# the verify-slot wait (p23-4: slotWait = max(VERIFY_SLOT_WAIT_MIN, HARNESS_MAX_S - VERIFY_HARNESS_MARGIN - N)),
# the verifier's own bound N and a margin, so the key tops out at 7200 - 600.
DEFAULT_VERIFY_TIMEOUT = 1800
VERIFY_HARNESS_MARGIN = 600
MAX_VERIFY_TIMEOUT = 6600
HARNESS_MAX_S = 7200
VERIFY_SLOT_WAIT_MIN = 60

# Every workflow status with a body section to write (reconcile) or scan (status).
SECTION_BY_STATUS = {**BLOCKED_SECTIONS, GATE_PENDING_STATUS: GATE_PENDING_SECTION}

# Matches the "(approved <date>)" sign-off annotation approve-gates appends to a gate line.
GATE_ANNOT_RE = re.compile(r"\s*\(approved [^)]*\)\s*$", re.I)

# ---- the queue (ADR 0030) ----
SET_ASIDE_STATUSES = {"review-blocked", "blocked", "plan-blocked", GATE_PENDING_STATUS}
FINISHED_STATUSES = {"done", "merged", "dropped"}   # mark-started refuses these; resume skips them
OUTSIDE_N = {"folded", "other"}                     # queue states that are not part of the rollout's N
# The vault's TaskNotes priority scale. `medium`, missing or unknown read as normal.
PRIORITY_WEIGHTS = {"high": 3, "normal": 2, "low": 1, "none": 0}
INTEGRATION_PREFIX = "integration:"                 # a blocked task's latest diagnosis -> set aside at Integration
# The engine's two named set-asides at Integration (p27-4, task.workflow.js INTEGRATION_CONFLICT_MARK and
# INTEGRATION_RED_MARK, lowercased): an Integration conflict and a verifier red. tests/lead-integrate.test.sh C11
# pins both, and integration_block against the engine's integrationBlockOf, byte-equal.
INTEGRATION_CONFLICT_MARK = "integration: conflict unresolved in "
INTEGRATION_RED_MARK = "integration: verifier red: "


def integration_block(text):
    """The engine's integrationBlockOf: which named set-aside at Integration a run's text opens — "conflict" (an
    Integration conflict), "red" (a verifier red at Integration) or None. The first non-blank line decides, stripped
    of JavaScript's whitespace and lowercased. Readers: status's per-task `integrationBlock`, the Run record's
    set-aside reasonClass (_reason_class) and lead-integrate.py's set-aside escape."""
    for line in ("" if text is None else str(text)).split("\n"):
        first = line.strip(_JS_WS)
        if first:
            low = first.lower()
            if low.startswith(INTEGRATION_CONFLICT_MARK):
                return "conflict"
            if low.startswith(INTEGRATION_RED_MARK):
                return "red"
            return None
    return None
# A rung name (ADR 0029): written raw as `rung: <name>`, so a plain lowercase token YAML reads back as the same
# string — ladder.py's NAME_RE and YAML_WORDS, and the engine's LADDER_NAME and LADDER_YAML_WORDS.
# tests/ladder.test.mjs (L9) feeds the same names to all three and pins that they agree.
RUNG_NAME_RE = re.compile(r"[a-z][a-z0-9._-]*\Z")
RUNG_YAML_WORDS = frozenset(("true", "false", "yes", "no", "on", "off", "y", "n", "null"))


def is_rung_name(value) -> bool:
    """A usable rung name: the one rule reconcile's stamp and lead-integrate.py inputs both apply."""
    return isinstance(value, str) and bool(RUNG_NAME_RE.match(value)) and value not in RUNG_YAML_WORDS


RUN_HEAD_RE = re.compile(r"^### Run (\d+) \(([^)]*)\)\s*$")
RUN_END_RE = re.compile(r"^<!-- run (\d+) end sha=([0-9a-f]{12}) -->\s*$")
# Lines of written content the note's structure would misread (see _neutralise): an ATX heading at level
# 1-3, whatever its indentation (`## ` ends a section, `### Run <n> (…)` opens a run, and section lookups
# match a heading on its stripped text), and anything shaped like a run end marker.
STRUCTURAL_HEADING_RE = re.compile(r"^([ \t]*)(#{1,3})(?=[ \t]|$)")
RUN_END_LIKE_RE = re.compile(r"^<!-- run \d+ end\b")
FILESET_RE = re.compile(r"^\s*[-*]\s+(?P<slug>[^\s:]+?)\s*:\s*(?P<files>.*)$")
WIKILINK_RE = re.compile(r"\[\[([^\]]+?)\]\]")
# A wikilink's target up to its alias, heading or block anchor. A table cell escapes the alias pipe
# (`[[slug\|alias]]`), so the backslash ends the target too (as in reconcile-project.py).
WIKILINK_OPEN_RE = re.compile(r"\[\[([^\]|#^\\]+)")
# The rollout-body lines whose wikilinks rank a task: list items (`-`, `*`, `+`, `1.`) and table rows.
RANKED_LINE_RE = re.compile(r"^\s*(?:[-*+]\s|\d+[.)]\s|\|)")
FENCE_RE = re.compile(r"^\s*(?:```|~~~)")
# carry's `order` hints (p17-2, _order_hints): a task's short id is its slug's `-p<N>-<M>-` number, the vault
# grammar's short id `p<PHASE_N>-<M>` (skills/_shared/vault-grammar.md § Phase and task filenames: `p3.5-2` too;
# tests/contracts/vault-grammar.test.mjs pins this copy), and `p30-10` is never `p30-1`; a full wikilink, alias
# and all; a list item's leading marker; the clause breaks (`;` and a sentence end, never `:`); and the ordering
# words, read only outside every task name. `(?<!-)` keeps an HTML comment's `-->` out.
SHORT_ID_RE = re.compile(r"(?<!\w)p(\d+(?:\.\d+)?)-(\d+)(?!\w)", re.I)
WIKILINK_FULL_RE = re.compile(r"\[\[[^\]]*\]\]")
LIST_MARK_RE = re.compile(r"^\s*(?:[-*+]\s+|\d+[.)]\s+)")
ORDER_CLAUSE_RE = re.compile(r";|(?<=[.!?])\s+")
# A masked name: a placeholder built from two private-use characters (no prose holds them, and no clause break,
# word or short id matches them) around the name's index.
ORDER_MASK = "\ue000{}\ue001"
ORDER_MASK_RE = re.compile("\ue000(\\d+)\ue001")
ORDER_CUE_RE = re.compile(r"\b(?:after|before|once|then|until|depends?|depending|dependency|dependencies|"
                          r"blocked|blocks|gated|lands?|landed|waits?|follows?|needs?|requires?|prerequisites?)\b"
                          r"|\bahead\s+of\b|→|(?<!-)->", re.I)
PROJECT_ROOT_RE = re.compile(r"^Project root:\s*`?([^`\n]+?)`?\s*$", re.M)
PR_URL_RE = re.compile(r"^https://github\.com/([^/\s]+/[^/\s]+)/pull/(\d+)/?$")
PR_NUM_RE = re.compile(r"^#?(\d+)$")
# The engine's ISO_STAMP (task.workflow.js), the only startedAt shape the Integration log writes: `_stamp`'s
# offset-minute form, or seconds/fraction with `Z` or a `±HH[:]MM` offset. ASCII digits only.
ISO_STAMP_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})",
                          re.ASCII)


# ---- small value helpers ----------------------------------------------------

def _scalar(value) -> str:
    """A frontmatter scalar: inline ` # comment` dropped, quotes and whitespace stripped ('' for None)."""
    if value is None:
        return ""
    s = re.sub(r"\s+#.*$", "", str(value)).strip()
    return s.strip('"').strip("'").strip()


SHAPES = ("parallel", "serial")   # a rollout note's `shape:` (ADR 0040); no key reads as parallel


def _shape(note) -> str:
    """A rollout note's Shape: `serial` when its `shape:` scalar says `serial` (case-folded, quotes and an inline
    ` # comment` dropped), else `parallel` (no key, `parallel` or any other value)."""
    return SHAPES[1] if _scalar(note.get("shape")).lower() == SHAPES[1] else SHAPES[0]


def _start_unattended(note) -> bool:
    """The rollout start stamp (START_KEY): the first top-level `start:` line reads `unattended`, quotes and comment
    dropped, any case (the rule the Chorus Stage reads it by)."""
    return _scalar(note.get(START_KEY)).lower() == START_UNATTENDED


def _clear_start(note) -> bool:
    """Remove every top-level `start:` frontmatter line whose scalar reads `unattended` (so a stale second line can
    never re-arm the Stage); any other `start:` value and every indented line stay. True when one was removed."""
    pat = re.compile(rf"^{re.escape(START_KEY)}:\s*(.*)$")
    kept = [line for line in note._fm
            if not ((m := pat.match(line)) and _scalar(m.group(1)).lower() == START_UNATTENDED)]
    if len(kept) == len(note._fm):
        return False
    note._fm = kept
    note.dirty = True
    return True


def _truthy_flag(value) -> bool:
    """Frontmatter boolean-ish: true/yes/1 (any case, quoted or bare) counts as set."""
    if value is None:
        return False
    return _scalar(value).lower() in {"true", "yes", "1"}


def _int_field(value, default):
    """Parse an int-ish frontmatter value, tolerating quotes and inline `# comments`."""
    if value is None:
        return default
    s = str(value).split("#", 1)[0].strip().strip('"').strip("'")
    try:
        return int(s)
    except ValueError:
        return default


def _wikilink_slug(value):
    """Normalise a wikilink or string (`"[[Area/Foo#Heading|alias]]"`) to a bare slug for comparison:
    the alias, a `#heading` or `^block` anchor, a table's alias-escaping backslash (`[[foo\\|alias]]`)
    and any path are dropped, keeping the leaf. Obsidian note names cannot hold `|`, `#` or `^`."""
    if value is None:
        return None
    s = value.strip().strip('"').strip("'").strip()
    s = s.replace("[[", "").replace("]]", "").strip()
    s = re.split(r"[|#^]", s, maxsplit=1)[0].rstrip().rstrip("\\")
    s = s.split("/")[-1].strip()
    if s.endswith(".md"):
        s = s[:-3]
    return s or None


def _list_items(value: str):
    """The entries of a frontmatter value: an inline `[a, "[[b]]"]` list's items or the scalar itself
    (a lone unquoted `[[a]]` is a wikilink, not a list). Each entry is a wikilink's inner text or a bare
    value; quotes stripped; `null`/`~` and empty entries dropped. Commas inside a wikilink never split."""
    v = value.strip()
    if v.startswith("[") and v.endswith("]") and not v.startswith("[["):
        v = v[1:-1]
    out = []
    for part in re.split(r",(?![^\[]*\]\])", v):
        part = part.strip().strip('"').strip("'").strip()
        links = WIKILINK_RE.findall(part)
        if links:
            out.extend(links)
        elif part and part.lower() not in ("null", "~"):
            out.append(part)
    return out


# ---- time ---------------------------------------------------------------------
# The Workflow sandbox cannot read clocks (Date.now() throws), so wall-clock enters here. Every stamp
# this script writes comes from one helper, so durations never mix forms.

def _stamp(dt) -> str:
    """The one stamp format: local time, minute precision, with its offset (2026-10-02T14:05+10:00)."""
    return dt.astimezone().isoformat(timespec="minutes")


def _parse_ts(value):
    """ISO timestamp from a frontmatter value or gh's mergedAt, or None. A trailing Z is parsed (Python
    3.9's fromisoformat refuses it); naive values are assumed local time."""
    s = _scalar(value)
    if not s:
        return None
    if s[-1] in "Zz":
        s = s[:-1] + "+00:00"
    try:
        ts = datetime.fromisoformat(s)
    except ValueError:
        return None
    return ts if ts.tzinfo else ts.astimezone()


# The engine's isoMinutes / wholeMinutes (task.workflow.js), ported byte for byte so the lead's own log
# line measures wait and duration exactly as an integrate row's metrics do (tests/lead-integrate.test.sh
# pins the two against each other). JS's String.prototype.trim strips this set.
_JS_WS = "\t\n\v\f\r              " \
         "    　﻿"


def _days_from_civil(y, m, d):
    yy = y - 1 if m <= 2 else y
    era = yy // 400
    yoe = yy - era * 400
    doy = (153 * (m + (-3 if m > 2 else 9)) + 2) // 5 + d - 1
    return era * 146097 + yoe * 365 + yoe // 4 - yoe // 100 + doy - 719468


def _iso_minutes(s):
    """An ISO stamp as minutes since the epoch, or None (the engine's isoMinutes)."""
    if not isinstance(s, str):
        return None
    m = ISO_STAMP_RE.fullmatch(s.strip(_JS_WS))
    if not m:
        return None
    y, mo, d, h, mi = (int(m.group(i)) for i in range(1, 6))
    se = 0 if m.group(6) is None else int(m.group(6))
    leap = (y % 4 == 0 and y % 100 != 0) or y % 400 == 0
    mdays = [31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    if mo < 1 or mo > 12 or d < 1 or d > mdays[mo - 1] or h > 23 or mi > 59 or se > 59:
        return None
    off = 0
    if m.group(7) != "Z":
        digits = m.group(7)[1:].replace(":", "")
        oh, om = int(digits[:2]), int(digits[2:])
        if oh > 23 or om > 59:
            return None
        off = (-1 if m.group(7)[0] == "-" else 1) * (oh * 60 + om)
    return _days_from_civil(y, mo, d) * 1440 + h * 60 + mi + se / 60 - off


def _whole_minutes(start, end):
    """Whole minutes from one stamp to another; None when either is missing or unparseable, or the span is
    negative (the engine's wholeMinutes; JS Math.round is floor(x + 0.5))."""
    f, t = _iso_minutes(start), _iso_minutes(end)
    if f is None or t is None:
        return None
    secs = math.floor((t - f) * 60 + 0.5)
    return None if secs < 0 else secs // 60


def _iso_arg(value):
    """argparse type for --now."""
    ts = _parse_ts(value)
    if ts is None:
        raise argparse.ArgumentTypeError(f"not an ISO timestamp: {value!r}")
    return ts


def _now(args):
    return getattr(args, "now", None) or datetime.now().astimezone()


def _fmt_min(minutes) -> str:
    """42 -> '42m', 84 -> '1h 24m', 120 -> '2h'."""
    m = max(0, int(round(minutes)))
    if m < 60:
        return f"{m}m"
    h, r = divmod(m, 60)
    return f"{h}h {r}m" if r else f"{h}h"


def _rough_label(minutes, infix: str = "") -> str:
    """The single rendering of the remaining estimate — always '~<duration>[infix] (rough)'. Both
    `remainingLabel` and the progress line derive from here so the 'always labelled rough' invariant has
    one source and the two renderings can never drift."""
    return f"~{_fmt_min(minutes)}{infix} (rough)"


# ---- accumulated runs (p6-4) ------------------------------------------------------

def _normalise(text: str) -> str:
    """Lines right-stripped, outer blank lines dropped, runs of blank lines collapsed."""
    lines = [line.rstrip() for line in str(text).split("\n")]
    while lines and not lines[0]:
        lines.pop(0)
    while lines and not lines[-1]:
        lines.pop()
    out = []
    for line in lines:
        if not line and out and not out[-1]:
            continue
        out.append(line)
    return "\n".join(out)


def _sha12(normalised: str) -> str:
    return hashlib.sha256(normalised.encode("utf-8")).hexdigest()[:12]


def _neutralise(text: str) -> str:
    """Content as written into a section. Feedback is free LLM text, so a line of it can look like note
    structure: a `## ` line would end the section for every reader (the next reconcile would put Run 2
    inside Run 1), a `### Run <n> (…)` line would open a run and an end marker would close one. A heading
    at level 1-3 is pushed three levels down (`## Root cause` -> `##### Root cause`, keeping the
    hierarchy under its `### Run` heading) and a run-end-shaped line is indented one space (still a
    comment). Every other line is unchanged. Hashes are over the content as given, never this form."""
    out = []
    for line in text.split("\n"):
        line = STRUCTURAL_HEADING_RE.sub(r"\1###\2", line)
        if RUN_END_LIKE_RE.match(line):
            line = " " + line
        out.append(line)
    return "\n".join(out)


def quote_block(text: str) -> str:
    """A text stored as a markdown quote (the approved plan, p14-2): CRLF (and a lone CR) normalised to LF,
    trailing whitespace dropped, each line written `> <line>` and a blank line `>`. No stored line can read as
    note structure: it starts with `>`, never `## `, `#`, `### Run` or `<!-- run`."""
    lines = str(text).replace("\r\n", "\n").replace("\r", "\n").rstrip().split("\n")
    return "\n".join(("> " + line) if line else ">" for line in lines)


def unquote_block(lines) -> str:
    """quote_block's inverse over a section's lines: only the `>` lines are kept, each with one `> ` (or a bare
    `>`) stripped, so a lead-in or blank line around the quote is not part of the text."""
    out = []
    for line in lines:
        if line.startswith("> "):
            out.append(line[2:])
        elif line.startswith(">"):
            out.append(line[1:])
    return "\n".join(out)


def approved_plan(note) -> str:
    """The note's approved plan (p14-2): the `> ` quote under `## Approved plan`, unquoted; '' when the note
    has no such section (never plan-gated, or the last own call was not)."""
    found = note._section_bounds(APPROVED_PLAN_SECTION)
    if found is None:
        return ""
    lines, start, end = found
    return unquote_block(lines[start + 1:end])


def needs_human(note) -> str:
    """The note's open question for a person (p16-3): the `## Needs you` section's text, normalised (_normalise);
    '' when the note has no such section or it is empty."""
    found = note._section_bounds(NEEDS_HUMAN_SECTION)
    if found is None:
        return ""
    lines, start, end = found
    return _normalise("\n".join(lines[start + 1:end]))


def _run_end(n: int, sha: str) -> str:
    return f"<!-- run {n} end sha={sha} -->"


def _parse_runs(lines, lo: int, hi: int):
    """The run blocks among lines[lo:hi]: [{n, head, end, sha, stop}]. `end` is the end marker's index
    (None when it is gone) and `stop` the exclusive end of the run's content: its marker, or — for a run
    whose marker was removed — the next run heading or the section end."""
    runs, cur = [], None
    for i in range(lo, hi):
        mh = RUN_HEAD_RE.match(lines[i])
        if mh:
            if cur is not None:
                cur["stop"] = i
                runs.append(cur)
            cur = {"n": int(mh.group(1)), "head": i, "end": None, "sha": None, "stop": hi}
            continue
        me = RUN_END_RE.match(lines[i])
        if me and cur is not None and int(me.group(1)) == cur["n"]:
            cur.update(end=i, sha=me.group(2), stop=i)
            runs.append(cur)
            cur = None
    if cur is not None:
        runs.append(cur)
    return runs


def _top_run(runs):
    """The highest-numbered run (the later one on a duplicate number)."""
    return max(enumerate(runs), key=lambda e: (e[1]["n"], e[0]))[1]


# ---- frontmatter surgery (order/format preserving) --------------------------

class Note:
    """A markdown note split into (frontmatter lines, body text), edited in place."""

    def __init__(self, path: Path):
        self.path = path
        text = path.read_text()
        m = re.match(r"^(---\n)(.*?\n)(---\n)(.*)$", text, re.DOTALL)
        if not m:
            raise ValueError(f"{path}: no YAML frontmatter block found")
        self._fm = m.group(2).rstrip("\n").split("\n")  # list of frontmatter lines (no delimiters)
        self._body = m.group(4)                          # verbatim body text after the closing ---
        self.dirty = False

    def get(self, key: str):
        pat = re.compile(rf"^{re.escape(key)}:\s*(.*)$")
        for line in self._fm:
            mm = pat.match(line)
            if mm:
                return mm.group(1).strip()
        return None

    def get_list(self, key: str):
        """`key:` as a list: a block list (`key:` then `  - item` lines), an inline `[a, b]` list or a
        scalar. Each entry is a wikilink's inner text or a bare value (callers normalise slugs with
        _wikilink_slug). [] when the key is absent or empty."""
        pat = re.compile(rf"^{re.escape(key)}:(.*)$")
        for i, line in enumerate(self._fm):
            mm = pat.match(line)
            if not mm:
                continue
            value = re.sub(r"\s+#.*$", "", mm.group(1)).strip()
            if value:
                return _list_items(value)
            out = []
            for item in self._fm[i + 1:]:
                mi = re.match(r"^\s*-\s*(.*)$", item)
                if mi:
                    out.extend(_list_items(re.sub(r"\s+#.*$", "", mi.group(1)).strip()))
                elif item.strip():
                    break
            return out
        return []

    def unset(self, key: str):
        """Remove `key:` from the frontmatter entirely. Idempotent; used to retire a marker that a
        later, better-informed run has superseded (a stale marker is triaged against, so leaving one
        is worse than never writing it)."""
        pat = re.compile(rf"^{re.escape(key)}:\s*")
        kept = [line for line in self._fm if not pat.match(line)]
        if len(kept) != len(self._fm):
            self._fm = kept
            self.dirty = True

    def set(self, key: str, value, after=("owner", "status")):
        """Replace `key:`'s value in place, or insert a new line after the first present anchor key."""
        newline = f"{key}: {value}"
        pat = re.compile(rf"^{re.escape(key)}:\s*")
        for i, line in enumerate(self._fm):
            if pat.match(line):
                if line != newline:
                    self._fm[i] = newline
                    self.dirty = True
                return
        # not present — insert just after the first available anchor key
        for anchor in after:
            apat = re.compile(rf"^{re.escape(anchor)}:\s*")
            for i, line in enumerate(self._fm):
                if apat.match(line):
                    self._fm.insert(i + 1, newline)
                    self.dirty = True
                    return
        self._fm.append(newline)
        self.dirty = True

    def remove(self, key: str):
        """Delete the `key:` line from frontmatter entirely (idempotent — no-op if absent)."""
        pat = re.compile(rf"^{re.escape(key)}:\s*")
        kept = [line for line in self._fm if not pat.match(line)]
        if len(kept) != len(self._fm):
            self._fm = kept
            self.dirty = True

    def has_heading(self, heading: str) -> bool:
        return any(line.strip() == heading for line in self._body.split("\n"))

    def section_text(self, heading: str) -> str:
        """Return the body text under `## heading`, up to the next `## ` heading or EOF (read-only)."""
        out, capturing = [], False
        for line in self._body.split("\n"):
            if line.strip() == heading:
                capturing = True
                continue
            if capturing and line.startswith("## "):
                break
            if capturing:
                out.append(line)
        return "\n".join(out).strip()

    def append_section(self, heading: str, content: str):
        """Append `## heading\\n\\n<content>` to the body once (idempotent on the heading)."""
        if self.has_heading(heading):
            return
        block = self._body.rstrip("\n")
        sep = "\n\n" if block else ""
        self._body = f"{block}{sep}\n{heading}\n\n{content.rstrip()}\n"
        self.dirty = True

    def _section_bounds(self, heading: str):
        """(start, end) line indices of `## heading` + its content, or None if absent."""
        lines = self._body.split("\n")
        for i, line in enumerate(lines):
            if line.strip() == heading:
                end = i + 1
                while end < len(lines) and not lines[end].startswith("## "):
                    end += 1
                return lines, i, end
        return None

    def _set_body_lines(self, lines):
        new_body = "\n".join(lines)
        if new_body != self._body:
            self._body = new_body
            self.dirty = True

    def upsert_section(self, heading: str, content: str):
        """Create `## heading` with content, or REPLACE the existing section's content in place
        (unlike append_section's heading-idempotence — for sections whose content must track the
        latest state, e.g. a refreshed gated-inputs declaration). Idempotent on identical content: the
        content is written neutralised, so a `## ` line in it can never end the section (which would
        make the next upsert duplicate everything after that line)."""
        content = _neutralise(content.rstrip())
        found = self._section_bounds(heading)
        if found is None:
            self.append_section(heading, content)
            return
        lines, start, end = found
        self._set_body_lines(lines[:start + 1] + [""] + content.rstrip().split("\n") + [""] + lines[end:])

    def remove_section(self, heading: str):
        """Delete `## heading` and its content from the body (idempotent — no-op if absent)."""
        found = self._section_bounds(heading)
        if found is None:
            return
        lines, start, end = found
        while start > 0 and not lines[start - 1].strip():
            start -= 1  # absorb the blank gap above the heading so removal leaves no double gap
        head, tail = lines[:start], lines[end:]
        if head and tail and head[-1].strip():
            head.append("")  # keep one blank line between the neighbours we just joined
        if head and not tail:
            head.append("")  # section was last — preserve the trailing newline
        self._body = "\n".join(head + tail)
        self.dirty = True

    def run_blocks(self, heading: str):
        """The `### Run <n>` blocks of the first `heading` section ([] when absent or legacy), each
        {n, head, end, sha, stop, content} with content normalised."""
        found = self._section_bounds(heading)
        if found is None:
            return []
        lines, start, end = found
        runs = _parse_runs(lines, start + 1, end)
        for r in runs:
            r["content"] = _normalise("\n".join(lines[r["head"] + 1:r["stop"]]))
        return runs

    def latest_run_text(self, heading: str) -> str:
        """The section's latest diagnosis: the content of its highest run, or the whole section
        (normalised) when it has no runs. '' when the section is absent."""
        found = self._section_bounds(heading)
        if found is None:
            return ""
        runs = self.run_blocks(heading)
        if runs:
            return _top_run(runs)["content"]
        lines, start, end = found
        return _normalise("\n".join(lines[start + 1:end]))

    def append_run(self, heading: str, content: str, now):
        """Record one run of feedback under `heading` (p6-4: every run is kept, not only the first).

        Rules, in order (content is normalised, the sha is over that, and it is written neutralised —
        see _neutralise; empty content writes nothing):
          1. No section: create it holding Run 1.
          2. The highest run's recorded sha equals the new sha: do nothing (a re-reconcile of the same
             result). A run whose end marker is gone is compared by its normalised extent against the
             neutralised content instead. Earlier runs are never compared, so A/B/A appends A again.
          3. The foreign tail — the text after the last end marker, or the whole section when it has no
             runs — normalises equal to the new content, and that content has no line _neutralise would
             change: adopt it in place, inserting the heading before its first non-blank line and the
             marker after its last, changing none of its bytes. This is the same-run copy an implementer
             agent writes into the note itself. (Content with such a line is appended instead: adopting
             it would keep a structural line inside the run.)
          4. Otherwise append the block at the end of the section.
        Nothing already written is deleted or rewritten; legacy text with no run heading stays as it is."""
        body = _normalise(content)
        if not body:
            return
        sha = _sha12(body)
        written = _neutralise(body)
        found = self._section_bounds(heading)
        if found is None:
            self.append_section(heading, f"### Run 1 ({_stamp(now)})\n\n{written}\n\n{_run_end(1, sha)}")
            return
        lines, start, end = found
        runs = _parse_runs(lines, start + 1, end)
        if runs:
            top = _top_run(runs)
            if top["end"] is not None:
                same = top["sha"] == sha
            else:
                same = _normalise("\n".join(lines[top["head"] + 1:top["stop"]])) == written
            if same:
                return
        n = max((r["n"] for r in runs), default=0) + 1
        head = f"### Run {n} ({_stamp(now)})"

        if not runs:
            tail_lo = start + 1
        else:
            marked = [r["end"] for r in runs if r["end"] is not None]
            tail_lo = max(marked) + 1 if marked else None
        # written == body also rules out a `### Run` line in the tail (it would equal a body line).
        if tail_lo is not None and written == body and _normalise("\n".join(lines[tail_lo:end])) == body:
            filled = [i for i in range(tail_lo, end) if lines[i].strip()]
            first, last = filled[0], filled[-1]
            pre = ([""] if lines[first - 1].strip() else []) + [head, ""]
            post = ["", _run_end(n, sha)] + ([""] if last + 1 < len(lines) and lines[last + 1].strip() else [])
            self._set_body_lines(lines[:first] + pre + lines[first:last + 1] + post + lines[last + 1:])
            return

        j = end
        while j > start + 1 and not lines[j - 1].strip():
            j -= 1
        block = ["", head, "", *written.split("\n"), "", _run_end(n, sha), ""]
        self._set_body_lines(lines[:j] + block + lines[end:] if end < len(lines) else lines[:j] + block)

    def append_line(self, heading: str, line: str):
        """Record one bare line under `heading` (the Integration log), creating the section when absent.

        Dedupe, keyed on the line's first token (its startedAt): a line whose startedAt is set is skipped
        when an identical line (right-stripped) appears ANYWHERE in the section, so a re-reconcile and a
        replay of an older row are both no-ops; a line whose startedAt is `-` is skipped only when it
        equals the section's LAST non-blank line, so S, I, S' keeps three lines and the latest stays
        truthful (back-to-back identical `-` lines collapse). Otherwise the line goes right after the
        section's last non-blank line, keeping one blank line after the heading and before any following
        `## ` section. Nothing already written is deleted or rewritten."""
        found = self._section_bounds(heading)
        if found is None:
            self.append_section(heading, line)
            return
        lines, start, end = found
        filled = [i for i in range(start + 1, end) if lines[i].strip()]
        kept = [lines[i].rstrip() for i in filled]
        if line.split(" ", 1)[0] != "-":
            if line in kept:
                return
        elif kept and kept[-1] == line:
            return
        if not filled:
            # An empty section: its blank lines become one either side of the new line.
            self._set_body_lines(lines[:start + 1] + ["", line, ""] + lines[end:])
            return
        j = filled[-1] + 1
        tail = [""] if j == len(lines) or lines[j].strip() else []
        self._set_body_lines(lines[:j] + [line] + tail + lines[j:])

    def render(self) -> str:
        return "---\n" + "\n".join(self._fm) + "\n---\n" + self._body

    def save(self, dry_run=False):
        if dry_run or not self.dirty:
            return
        self.path.write_text(self.render())


def bullets(items):
    return "\n".join(f"- {s}" for s in items if str(s).strip())


def history_block(history):
    """Grouped by-round review history (engine reviewHistory: [{round, feedback: []}], latest last)."""
    rounds = []
    for entry in history or []:
        body = bullets(entry.get("feedback") or [])
        if body:
            rounds.append(f"Round {entry.get('round', '?')}:\n{body}")
    return "\n\n".join(rounds)


def _log_field(value, minutes=False) -> str:
    """One Integration log value. None, '', [] (or a non-int, or bool, minute count) -> `-`; a list is
    comma-joined in order; whitespace inside becomes `_`, so a line always has exactly 10 tokens. This
    guards the token count only: a value may still start with `#`, a backtick or `>`, which is why the
    line's one unprefixed token (startedAt) goes through _log_started instead."""
    if minutes:
        return str(value) if isinstance(value, int) and not isinstance(value, bool) else "-"
    if isinstance(value, (list, tuple)):
        value = ",".join(str(v).strip() for v in value if v is not None and str(v).strip())
    s = "" if value is None else str(value).strip()
    return re.sub(r"\s", "_", s) if s else "-"


def _log_started(value) -> str:
    """The line's leading token: startedAt when it is an ISO stamp (ISO_STAMP_RE, the engine's shape),
    else `-`. The lead supplies startedAt and the engine only checks it is a string, and it is the one
    token with no `key=` prefix, so it alone decides how the line starts; holding it to a digit or `-`
    means the line can never open a `## ` section (ending `## Integration log` above it), an H1, a code
    fence or a quote."""
    s = value.strip() if isinstance(value, str) else ""
    return s if ISO_STAMP_RE.fullmatch(s) else "-"


def _log_pr(pr_url) -> str:
    """The PR number of a row's prUrl (a GitHub PR URL, `#7` or `7`), else `-`: no arbitrary string ever
    reaches the `pr=` token, and an unparseable PR never fails the row (the line is a record)."""
    s = pr_url.strip() if isinstance(pr_url, str) else ""
    m = PR_URL_RE.match(s)
    if m:
        return m.group(2)
    m = PR_NUM_RE.match(s)
    return m.group(1) if m else "-"


def _integration_log_line(task) -> str:
    """The `## Integration log` line for a row carrying a dict `integration` (the engine's
    integrationResult): `<startedAt> <outcome> path=<p> pr=<n> anchor=<sha> head=<sha> base=<sha>
    wait=<n|-> duration=<n|-> triggers=<list|->`. startedAt is written verbatim when it is an ISO stamp
    (else `-`, see _log_started), SHAs in full. The line carries no `now`, so a re-reconcile at another
    time writes the same line."""
    integ = task["integration"]
    metrics = integ.get("metrics") if isinstance(integ.get("metrics"), dict) else {}
    anchor = integ.get("anchor") if isinstance(integ.get("anchor"), dict) else {}
    return " ".join([
        _log_started(metrics.get("startedAt")),
        _log_field(integ.get("outcome")),
        "path=" + _log_field(integ.get("path")),
        "pr=" + _log_pr(task.get("prUrl")),
        "anchor=" + _log_field(anchor.get("headSha")),
        "head=" + _log_field(integ.get("headSha")),
        "base=" + _log_field(integ.get("baseSha")),
        "wait=" + _log_field(metrics.get("waitMinutes"), minutes=True),
        "duration=" + _log_field(metrics.get("durationMinutes"), minutes=True),
        "triggers=" + _log_field(integ.get("triggers")),
    ])


def _log_lines(note) -> list:
    """The `## Integration log`'s non-blank lines, oldest first."""
    return [l.rstrip() for l in note.section_text(INTEGRATION_LOG_SECTION).split("\n") if l.strip()]


def _last_log_line(note):
    """The `## Integration log`'s LAST non-blank line, or None. The p12-16 contract has this one reader
    (approve-gates here, `lead-integrate.py`'s prepare and inputs through last_integration): read the last
    line, never a search, since old lines survive a defer or a recut."""
    lines = _log_lines(note)
    return lines[-1] if lines else None


def _status(note) -> str:
    return _scalar(note.get("status")).lower()


def _pr(note) -> str:
    return _scalar(note.get("pr"))


def _scope(note) -> str:
    return _scalar(note.get("scope")).lower()


def _landed(note) -> bool:
    """Merged for the queue: done, or a read-only task approved with nothing to merge."""
    st = _status(note)
    return st == "done" or (st == "review" and not _pr(note) and _scope(note) == "read-only")


# ---- the rollout's linked tasks ----------------------------------------------

def _scan(rollout_path: Path, tasks_dir: Path):
    """(linked, index): linked = (path, Note) for every task note carrying `rollout: [[<slug>]]` for this
    rollout (glob-by-backlink — captures read-only tasks the `## File-sets` block omits); index = stem
    (lowercased) -> (path, Note) for every note under tasks_dir, Archive included, preferring a root
    copy over an archived one (dependency lookups)."""
    rollout_slug = rollout_path.stem.lower()
    rollout_real = rollout_path.resolve()
    linked, index = [], {}
    for path in sorted(tasks_dir.rglob("*.md")):  # rglob to catch already-archived done tasks too
        if path.resolve() == rollout_real:
            continue
        try:
            note = Note(path)
        except ValueError:
            continue  # not a frontmatter note (or not UTF-8)
        key = path.stem.lower()
        prev = index.get(key)
        if prev is None or (prev[0].parent != tasks_dir and path.parent == tasks_dir):
            index[key] = (path, note)
        if (_wikilink_slug(note.get("rollout")) or "").lower() == rollout_slug:
            linked.append((path, note))
    return linked, index


def _linked_task_notes(rollout_path: Path, tasks_dir: Path):
    return _scan(rollout_path, tasks_dir)[0]


def _queue_state(note):
    """(queue state, setAsideAt) for one task note — the table in the module docstring."""
    st = _status(note)
    if st == "done":
        return "merged", None
    if st == "review":
        if _pr(note):
            return ("integrating" if _scalar(note.get("integrating")) else "awaiting-integration"), None
        if _scope(note) == "read-only":
            return "merged", None
        return "set-aside", "run"  # approved without a PR: nothing for Integration to merge
    if st == "in_progress":
        return "running", None
    if st in ("", "open"):
        return "queued", None
    if st in SET_ASIDE_STATUSES:
        if st == GATE_PENDING_STATUS:
            return "set-aside", "gate"
        if st == "blocked" and \
                note.latest_run_text(BLOCKED_SECTIONS["blocked"]).lower().startswith(INTEGRATION_PREFIX):
            return "set-aside", "integration"
        return "set-aside", "run"
    if st == "merged":
        return "folded", None
    return "other", None


STARTED_HEADINGS = ("## Pause log", "## Completion log", "## Leg log")


def _valued(value) -> bool:
    """A frontmatter value that says something: non-empty once quotes and an inline comment are dropped,
    and not YAML's null."""
    return _scalar(value).lower() not in ("", "null", "~")


def never_started(rollout_note, linked):
    """(True, '') when no execute session has run this rollout, else (False, reason). Only execute's own
    marks count (the module docstring's "Never started"): the rollout note's `paused:`, truthy
    `pause_requested`, `completed:`, a `## Pause log`, `## Completion log` or `## Leg log` heading; a linked task note's
    non-empty `owner:` or `integrating:` (`linked` is `_scan`'s list of (path, Note)). A task's status and
    its started:/ready:/merged: stamps never count, so a freshly carried rollout is still never started. A
    protocol-3 run shows through the `owner:` its engine stamped on each task at dispatch."""
    if _valued(rollout_note.get("paused")):
        return False, f"it carries paused: {_scalar(rollout_note.get('paused'))}"
    if _truthy_flag(rollout_note.get("pause_requested")):
        return False, "it carries pause_requested"
    if _valued(rollout_note.get("completed")):
        return False, f"it carries completed: {_scalar(rollout_note.get('completed'))}"
    for heading in STARTED_HEADINGS:
        if rollout_note.has_heading(heading):
            return False, f"it has a {heading} section"
    for path, note in sorted(linked, key=lambda pn: (pn[0].stem.lower(), str(pn[0]))):
        for key in ("owner", "integrating"):
            if _valued(note.get(key)):
                return False, f"its task {path.stem} carries {key}: {_scalar(note.get(key))}"
    return True, ""


def incomplete(rollout_path: Path, rollout_note, linked, index) -> str:
    """'' when the rollout can run as written, else why not (the module docstring's "Incomplete"). Only a
    never-started rollout is judged; `linked` and `index` are _scan's. The same-folder test compares
    resolved paths, as `_scan` does, so a symlinked or differently spelt vault path never skips it."""
    if not never_started(rollout_note, linked)[0]:
        return ""
    if _truthy_flag(rollout_note.get("incomplete")):
        return ("it carries incomplete: true (the /thread:schedule run that wrote it never reached step 7's (or "
                "§ Serial path S6's) last write, which removes it once every task is stamped, or § 0 stamped it "
                "finishing an interrupted supersede), so its queue may name tasks never stamped to it")
    prior = (_wikilink_slug(_scalar(rollout_note.get("supersedes"))) or "").lower()
    entry = index.get(prior) if prior else None
    if entry is not None and entry[0].parent.resolve() == rollout_path.parent.resolve() and \
            "rollout" in _tags(entry[1]) and _status(entry[1]) not in CLOSED_ROLLOUT_STATUSES:
        return (f"its supersedes: names [[{entry[0].stem}]], still unfinished beside it: the supersede has not "
                "closed that rollout out (schedule step 7.5)")
    return ""


def _priority(note) -> str:
    v = _scalar(note.get("priority")).lower()
    return v if v in PRIORITY_WEIGHTS else "normal"


def _dep_entries(note):
    """`depends-on:` plus `blocked-by:`, as slugs, in declared order, without duplicates."""
    out, seen = [], set()
    for key in ("depends-on", "blocked-by"):
        for entry in note.get_list(key):
            slug = _wikilink_slug(entry)
            if slug and slug.lower() not in seen:
                seen.add(slug.lower())
                out.append(slug)
    return out


def _fold_unit(slug: str, index):
    """(unit, entry, folded): a dependency followed through affine-merge tombstones to the unit that lands it.
    A tombstone (`status: merged`, `merged_into: [[u]]`) is a member schedule step 4.5 folded into the combined
    unit u, and its dependants still name the member, so every reader of a dependency resolves it here,
    cycle-guarded: _dep_status (the hold reason) and cmd_next's Integration queue order (_lane_key), which
    therefore cannot disagree. `unit` is the slug the chain ends on (`slug` itself when it is no tombstone),
    `entry` its index entry (None when its note is not found; a tombstone's when the chain ends on one with no
    `merged_into:` or closes a cycle), `folded` whether a `merged_into:` link was followed."""
    entry = index.get(slug.lower())
    unit, seen, folded = slug, {slug.lower()}, False
    while entry is not None and _status(entry[1]) == "merged":
        target = _wikilink_slug(entry[1].get("merged_into"))
        if not target:
            break
        if target.lower() in seen:
            return target, index.get(target.lower()), True
        seen.add(target.lower())
        unit, entry, folded = target, index.get(target.lower()), True
    return unit, entry, folded


def _dep_status(slug: str, index):
    """(satisfied, why): a dependency is satisfied only when its note is landed. A tombstone
    (`status: merged`) resolves through `merged_into:` to the combined unit (_fold_unit). `why` is
    the parenthesised part of a hold reason."""
    unit, entry, folded = _fold_unit(slug, index)
    if entry is None:
        ok, why = False, "note not found"
    elif _status(entry[1]) == "merged":
        ok, why = False, "merged"
    else:
        ok, why = _landed(entry[1]), _status(entry[1]) or "no status"
    return ok, f"folded into [[{unit}]] ({why})" if folded else why


def _unsatisfied(row, index):
    """Hold-reason fragments for a task's unsatisfied dependencies ([] when it is free to start)."""
    out = []
    for dep in row["deps"]:
        ok, why = _dep_status(dep, index)
        if not ok:
            out.append(f"depends on [[{dep}]] ({why})")
    return out


def _file_sets(rollout_note):
    """slug (lowercased) -> planned files, from the rollout's `## File-sets` lines
    (`- <slug>: a, b`). A task with no line plans no files (overlap 0)."""
    found = rollout_note._section_bounds("## File-sets")
    out = {}
    if found is None:
        return out
    lines, start, end = found
    for line in lines[start + 1:end]:
        m = FILESET_RE.match(line)
        if not m:
            continue
        slug = (_wikilink_slug(m.group("slug")) or "").lower()
        files = [f.strip().strip("`").strip() for f in m.group("files").split(",")]
        out[slug] = [f for f in files if f]
    return out


def _schedule_positions(rollout_note):
    """slug (lowercased) -> the ordinal of its first wikilink on a list-item or table-row line of the
    rollout body (the `## Queue` table or a queue list), outside fenced code. Prose never ranks,
    so a note the lead adds above the list mid-rollout cannot reorder the queue."""
    pos, i, fenced = {}, 0, False
    for line in rollout_note._body.split("\n"):
        if FENCE_RE.match(line):
            fenced = not fenced
            continue
        if fenced or not RANKED_LINE_RE.match(line):
            continue
        for m in WIKILINK_OPEN_RE.finditer(line):
            slug = (_wikilink_slug(m.group(1)) or "").lower()
            if slug and slug not in pos:
                pos[slug] = i
            i += 1
    return pos


def _rows(rollout_path: Path, rollout_note, tasks_dir: Path):
    """(rows, index): one dict per linked task note with everything the queue reads from it."""
    linked, index = _scan(rollout_path, tasks_dir)
    file_sets = _file_sets(rollout_note)
    positions = _schedule_positions(rollout_note)
    rows = []
    for path, note in linked:
        slug = path.stem
        state, set_aside_at = _queue_state(note)
        pos = positions.get(slug.lower())
        # Schedule rank: listed tasks by position, then unlisted ones by slug.
        rank = (0, pos, "") if pos is not None else (1, 0, slug.lower())
        priority = _priority(note)
        rows.append({
            "slug": slug, "path": path, "note": note, "state": state, "setAsideAt": set_aside_at,
            "status": _scalar(note.get("status")) or None, "pr": _pr(note) or None,
            "priority": priority, "weight": PRIORITY_WEIGHTS[priority], "solo": _truthy_flag(note.get("solo")),
            "files": file_sets.get(slug.lower(), []), "rank": rank, "deps": _dep_entries(note),
            "started": _scalar(note.get("started")) or None, "merged": _scalar(note.get("merged")) or None,
            "integrating": _scalar(note.get("integrating")) or None, "ready": _scalar(note.get("ready")) or None,
        })
    return rows, index


def _rank(row):
    return row["rank"]


def _lane_key(row, waited):
    """The Integration queue's order (p17-1): a task a queued task depends on, directly or through a folded member
    (`merged_into:`), first (`waited`: lowercased slugs, each dependency resolved by _fold_unit), then the oldest
    `ready:`, compared as instants (a missing or unparseable stamp after every stamped one), then schedule order."""
    m = _iso_minutes(row["ready"])
    return (0 if row["slug"].lower() in waited else 1, m if m is not None else math.inf, row["rank"])


# ---- race holds (status § 3's definitions) -------------------------------------

RACE_LOG_SECTION = "## Race log"
NOTES_SECTION = "## Notes"
# Lachy's recorded decision: `repair: [[<slug>]] RACE decided:`, matched on the link's target (an alias, a
# heading or a table-escaped pipe after it is allowed).
RACE_DECIDED_RE = re.compile(r"repair:\s*\[\[([^\]|#^\\]+)[^\]]*\]\]\s*RACE decided:", re.I)
UNVERIFIED_MARK = "UNVERIFIED:"


def _race_marks(rollout_note, linked):
    """{slug_lower: (slug, kind, decided)} for every linked task a RACE or UNVERIFIED marks, decided or not (the
    module docstring's "Race holds"). RACE: a note not done, merged or dropped whose slug a wikilink names on a line
    of the rollout's `## Race log`. UNVERIFIED: a set-aside note whose latest run (_blocker_summary) carries
    `UNVERIFIED:`. RACE wins when both apply. `decided` is True when a `repair: [[<slug>]] RACE decided:` line in the
    rollout's `## Notes` lifts it; a decision recorded anywhere else never does. `linked` is _scan's (path, Note)
    list. `rollout_note` None (hand-back's `rollout:` names no readable note) has no Race log and no decision, so
    only an undecided UNVERIFIED marks there. Read by _race_holds, and by the verbs that move a task because a
    decision lifted its hold (resume, hand-back, auto-retry: _record_decision records that once, p21-2)."""
    race_log = rollout_note.section_text(RACE_LOG_SECTION) if rollout_note is not None else ""
    notes = rollout_note.section_text(NOTES_SECTION) if rollout_note is not None else ""
    raced = set()
    for line in race_log.split("\n"):
        for m in WIKILINK_OPEN_RE.finditer(line):
            slug = (_wikilink_slug(m.group(1)) or "").lower()
            if slug:
                raced.add(slug)
    decided = {(_wikilink_slug(m.group(1)) or "").lower() for m in RACE_DECIDED_RE.finditer(notes)}
    marks = {}
    for path, note in linked:
        key = path.stem.lower()
        if key in raced and _status(note) not in FINISHED_STATUSES:
            marks[key] = (path.stem, "RACE", key in decided)
        elif _queue_state(note)[0] == "set-aside" and UNVERIFIED_MARK in _blocker_summary(note):
            marks[key] = (path.stem, "UNVERIFIED", key in decided)
    return marks


def _race_holds(rollout_note, linked):
    """{slug_lower: (slug, kind)} for every linked task an undecided RACE or UNVERIFIED holds: _race_marks without the
    decided ones, the same result as before p21-2. Read by `next` (and _awaits_sign_off), `carry`, `hold`, descope's
    owner check and lead-integrate.py; `resume`, `hand-back` and `auto-retry` read _race_marks, so the move a decision
    allows is recorded (_record_decision)."""
    return {k: (slug, kind) for k, (slug, kind, decided) in _race_marks(rollout_note, linked).items() if not decided}


# ---- the git-env hold (execute § 4.5 *Git-env canary*) ------------------------------------------------------

GIT_ENV_LOG_SECTION = "## Git-env log"
GIT_ENV_TRIP_MARK = "git-env trip"
GIT_ENV_ACK_MARK = "git-env ack"


def _git_env_hold(rollout_note):
    """The unacked git-env trips (the module docstring's "Git-env hold"): an ordered [{slug, kind, line}] of the
    `## Git-env log` trip lines that no later ack line names. A trip line's slug is the first wikilink after the
    mark and its kind the word before the next `:`; an ack line names every wikilink it carries. A line with
    neither mark is ignored. `rollout_note` None has no log, so no hold."""
    if rollout_note is None:
        return []
    trips = []
    for line in rollout_note.section_text(GIT_ENV_LOG_SECTION).split("\n"):
        line = line.rstrip()
        if GIT_ENV_TRIP_MARK in line:
            rest = line[line.index(GIT_ENV_TRIP_MARK) + len(GIT_ENV_TRIP_MARK):]
            m = WIKILINK_OPEN_RE.search(rest)
            slug = (_wikilink_slug(m.group(1)) or "") if m else ""
            if not slug:
                continue
            tail = rest[m.end():]
            tail = tail[tail.index("]]") + 2:] if "]]" in tail else tail
            km = re.match(r"\s*([A-Za-z-]+)\s*:", tail)
            trips.append({"slug": slug, "kind": km.group(1) if km else "", "line": line})
        elif GIT_ENV_ACK_MARK in line:
            acked = {(_wikilink_slug(m.group(1)) or "").lower() for m in WIKILINK_OPEN_RE.finditer(line)}
            trips = [t for t in trips if t["slug"].lower() not in acked]
    return trips


# rollout-settings.py, shared with every skill: the operator's ~/.config/thread/rollouts.toml (p15-4).
ROLLOUT_SETTINGS_PY = Path(__file__).resolve().parent.parent.parent / "_shared" / "scripts" / "rollout-settings.py"
# gated_inputs.py, beside it: the standing approval's exposure reading and annotation (ADR 0034).
GATED_INPUTS_PY = ROLLOUT_SETTINGS_PY.parent / "gated_inputs.py"
_GATED = None


def _gated():
    """gated_inputs.py as a module (loaded once; raises when it will not load)."""
    global _GATED
    if _GATED is None:
        spec = importlib.util.spec_from_file_location("thread_gated_inputs", GATED_INPUTS_PY)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _GATED = mod
    return _GATED


_SETTINGS_MOD = None


def _settings_module():
    """rollout-settings.py as a module (loaded once per process; raises when it will not load)."""
    global _SETTINGS_MOD
    if _SETTINGS_MOD is None:
        spec = importlib.util.spec_from_file_location("thread_rollout_settings", ROLLOUT_SETTINGS_PY)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _SETTINGS_MOD = mod
    return _SETTINGS_MOD


def _machine_settings():
    """(settings, error): rollout-settings.py's resolve(repo=None), the machine-wide view (p23-4: `verify_slots`):
    rollouts.toml's [defaults], then the built-in, the whole file validated. error is the resolver's own words (a
    refused file `<path>:<line>: <reason>`, no tomllib, a loader failure); never raises."""
    try:
        mod = _settings_module()
    except Exception as e:
        return None, f"rollout-settings.py would not load: {e}"
    try:
        return mod.resolve(repo=None)["settings"], None
    except mod.SettingsError as e:
        return None, str(e)
    except Exception as e:
        return None, f"rollout-settings.py failed: {e}"


def _resolved_settings(rollout_note) -> dict:
    """rollout-settings.py's resolve() for the rollout note's Project root (repo=None when it has no Project root line):
    rollouts.toml's [repo."<slug>"], then [defaults], then the built-in. {settings, error, cause, where}: settings is
    resolve()'s `settings` object (each key {value, source}), or None when it cannot resolve, and then error is the
    resolver's own words and cause what the error needs: "resolver" (rollout-settings.py would not load, or failed),
    "root" (a `--repo` refusal: the Project root is gone or its origin unreadable) or "file" (rollouts.toml was
    refused; `where` names its path and line). The one loader _resolved_ceiling, _resolved_caps and _retry_budget
    share; it writes nothing and never raises."""
    root = _project_root(rollout_note)
    try:
        mod = _settings_module()
    except Exception as e:
        return {"settings": None, "error": f"rollout-settings.py would not load: {e}", "cause": "resolver", "where": ""}
    try:
        settings = mod.resolve(repo=None if root is None else str(root))["settings"]
        return {"settings": settings, "error": None, "cause": None, "where": ""}
    except mod.SettingsError as e:
        if (e.subject or "").startswith("--repo "):
            return {"settings": None, "error": str(e), "cause": "root", "where": ""}
        where = f"{e.subject} at line {e.line}" if e.line is not None else f"{e.subject}"
        return {"settings": None, "error": str(e), "cause": "file", "where": where}
    except Exception as e:
        return {"settings": None, "error": f"rollout-settings.py failed: {e}", "cause": "resolver", "where": ""}


# A null ceiling's cause (status's `ceilingCause`, status § 3's Ceiling unresolved flag) picks its remedy: "stamp"
# (the note's own value is invalid: fix it), "file" (rollouts.toml was refused: fix the named line, or stamp the key),
# "root" (the Project root is gone or its origin unreadable: stamp the key), "resolver" (it would not run: stamp it).
def _resolved_ceiling(rollout_note):
    """(ceiling, error, cause) for a note with no `parallel_ceiling`: _resolved_settings' parallel_ceiling. Any
    failure is (None, error, cause), the error the resolver's own words plus the remedy that fits its cause, so
    `next` exits 1 and status flags it; never a guessed ceiling."""
    res = _resolved_settings(rollout_note)
    if res["settings"] is not None:
        try:
            return res["settings"]["parallel_ceiling"]["value"], None, None
        except Exception as e:
            res = {"error": f"rollout-settings.py failed: {e}", "cause": "resolver"}
    if res["cause"] == "root":
        return None, (f"parallel_ceiling is absent and the Project root cannot be read: {res['error']} (the Project "
                      f"root is gone or has no readable origin: stamp parallel_ceiling: on the rollout note)"), "root"
    if res["cause"] == "file":
        return None, (f"parallel_ceiling is absent and the rollout settings were refused: {res['error']} (fix "
                      f"{res['where']}, or stamp parallel_ceiling: on the rollout note)"), "file"
    return None, (f"parallel_ceiling is absent and {res['error']} "
                  f"(stamp parallel_ceiling: on the rollout note)"), "resolver"


def _ceiling_detail(rollout_note):
    """(ceiling, error, cause): `parallel_ceiling`, an integer >= 1; absent -> the operator's rollout settings
    (_resolved_ceiling: rollouts.toml, then the built-in 4); anything else -> error, cause "stamp"."""
    raw = rollout_note.get("parallel_ceiling")
    if raw is None:
        return _resolved_ceiling(rollout_note)
    s = _scalar(raw)
    if re.fullmatch(r"[0-9]+", s) and int(s) >= 1:
        return int(s), None, None
    return None, (f"parallel_ceiling must be an integer >= 1, got {raw!r} "
                  f"(fix the rollout note's parallel_ceiling: stamp)"), "stamp"


def _ceiling(rollout_note):
    """(ceiling, error): _ceiling_detail without the cause."""
    return _ceiling_detail(rollout_note)[:2]


def _verify_timeout(rollout_note):
    """(seconds, error): `verify_timeout`, an integer from 1 to MAX_VERIFY_TIMEOUT; absent -> 1800; anything
    else -> error. Read like `parallel_ceiling` (_scalar: a quoted value or a trailing ` # comment` is fine).
    Only the rollout note is read, so a task-level key never applies."""
    raw = rollout_note.get("verify_timeout")
    if raw is None:
        return DEFAULT_VERIFY_TIMEOUT, None
    s = _scalar(raw)
    if re.fullmatch(r"[0-9]+", s) and 1 <= int(s) <= MAX_VERIFY_TIMEOUT:
        return int(s), None
    return None, f"verify_timeout must be an integer from 1 to {MAX_VERIFY_TIMEOUT}, got {raw!r}"


def _overlap(files, in_flight) -> int:
    """How many of a task's planned files match an in-flight file, exactly or by fnmatch either way."""
    return sum(1 for f in files
               if any(f == g or fnmatch.fnmatchcase(f, g) or fnmatch.fnmatchcase(g, f) for g in in_flight))


# ---- counts, timeline, progress ----------------------------------------------

COUNT_KEY = {"merged": "merged", "running": "running", "integrating": "integrating",
             "awaiting-integration": "awaitingIntegration", "queued": "queued", "set-aside": "setAside",
             "folded": "folded", "other": "other"}


def _counts(rows):
    c = {k: 0 for k in ("merged", "running", "integrating", "awaitingIntegration", "queued", "setAside",
                        "setAsideAtIntegration", "folded", "other")}
    for r in rows:
        c[COUNT_KEY[r["state"]]] += 1
        if r["setAsideAt"] == "integration":
            c["setAsideAtIntegration"] += 1
    c["total"] = sum(c[k] for k in ("merged", "running", "integrating", "awaitingIntegration", "queued", "setAside"))
    return c


def _timeline(rows, counts, ceiling, now):
    """The per-task progress/ETA block, or None when no task has a parseable `started:`. In-rollout
    arithmetic only, deliberately rough (always labelled `~… (rough)`): the mean per-task duration
    (started -> merged) x the chunks still ahead at the ceiling."""
    in_n = [r for r in rows if r["state"] not in OUTSIDE_N]
    entries = []
    for r in in_n:
        started = _parse_ts(r["started"])
        if started is None:
            continue
        merged = _parse_ts(r["merged"])
        duration = int(round((merged - started).total_seconds() / 60.0)) if merged else None
        entries.append((started, r["slug"], {
            "slug": r["slug"], "started": r["started"], "merged": r["merged"] if merged else None,
            "durationMinutes": duration,
        }))
    if not entries:
        return None
    entries.sort(key=lambda e: (e[0], e[1]))
    first_started = entries[0][0]
    merges = [(m, r["merged"]) for r in in_n for m in [_parse_ts(r["merged"])] if m is not None]
    last_merged = max(merges, key=lambda e: e[0]) if merges else None
    complete = counts["total"] > 0 and counts["merged"] == counts["total"]
    end = last_merged[0] if (complete and last_merged) else now
    elapsed = max(0.0, (end - first_started).total_seconds() / 60.0)
    durations = [e[2]["durationMinutes"] for e in entries
                 if e[2]["durationMinutes"] is not None and e[2]["durationMinutes"] >= 0]
    avg = sum(durations) / len(durations) if durations else None
    pending = counts["running"] + counts["queued"]
    remaining = int(round(avg * math.ceil(pending / ceiling))) if (avg is not None and pending and ceiling) else None
    return {
        "tasks": [e[2] for e in entries],
        "firstStarted": entries[0][2]["started"],
        "lastMerged": last_merged[1] if last_merged else None,
        "elapsedMinutes": int(round(elapsed)),
        "elapsedLabel": _fmt_min(elapsed),
        "avgTaskMinutes": round(avg, 1) if avg is not None else None,
        "durationsUsed": len(durations),
        "remainingEstimateMinutes": remaining,
        "remainingLabel": _rough_label(remaining) if remaining is not None else None,
        "complete": complete,
    }


def _progress_line(counts, timeline) -> str:
    """`progress: <M>/<N> merged[, <n> running][, <n> integrating][, <n> awaiting integration][, <n>
    queued][, <n> set aside[ (<k> at Integration)]][ — <elapsed> elapsed[, ~<d> remaining (rough)]]`;
    complete: `progress: <N>/<N> merged — rollout complete[ in <elapsed>]`; empty: `progress: 0/0 merged`."""
    n, m = counts["total"], counts["merged"]
    if n == 0:
        return "progress: 0/0 merged"
    if m == n:
        return f"progress: {n}/{n} merged — rollout complete" + (f" in {timeline['elapsedLabel']}" if timeline else "")
    line = f"progress: {m}/{n} merged"
    for key, label in (("running", "running"), ("integrating", "integrating"),
                       ("awaitingIntegration", "awaiting integration"), ("queued", "queued")):
        if counts[key]:
            line += f", {counts[key]} {label}"
    if counts["setAside"]:
        line += f", {counts['setAside']} set aside"
        if counts["setAsideAtIntegration"]:
            line += f" ({counts['setAsideAtIntegration']} at Integration)"
    if timeline:
        line += f" — {timeline['elapsedLabel']} elapsed"
        if timeline["remainingEstimateMinutes"] is not None:
            line += ", " + _rough_label(timeline["remainingEstimateMinutes"], infix=" remaining")
    return line


def _progress_for(rollout_path: Path, tasks_dir: Path, now) -> str:
    """The progress line for a rollout, read fresh from its notes (after any writes this call made)."""
    rollout_note = Note(rollout_path)
    rows, _index = _rows(rollout_path, rollout_note, tasks_dir)
    counts = _counts(rows)
    ceiling, _err = _ceiling(rollout_note)
    return _progress_line(counts, _timeline(rows, counts, ceiling, now))


def _print_progress(args, now):
    """Print the progress line when the verb was given --rollout (the lead relays it, ADR 0030)."""
    if not getattr(args, "rollout", None):
        return
    path = Path(os.path.expanduser(args.rollout))
    try:
        if not _is_kind(path, stat.S_ISREG):
            print(f"WARN: rollout note not found at {path} — no progress line", file=sys.stderr)
            return
        line = _progress_for(path, Path(os.path.expanduser(args.tasks_dir)), now)
    except (OSError, ValueError) as e:  # an unreadable note costs the line, never the verb's own exit (p26-3)
        print(f"WARN: cannot read rollout note {path}: {e} — no progress line", file=sys.stderr)
        return
    print(line)


# ---- reconcile --------------------------------------------------------------

def resolve_task_path(task, tasks_dir: Path) -> Path:
    # Prefer an explicit taskPath if the result carries one; else resolve <tasks-dir>/<slug>.md
    # (exactly how execute builds taskPath in the args it dispatched).
    tp = task.get("taskPath")
    if tp:
        return Path(os.path.expanduser(tp))
    return tasks_dir / f"{task['slug']}.md"


def _rung_note(task) -> str:
    """The reconcile line's rung part: ` rung=<name>`, then ` from=<start>` when the call climbed off it,
    ` climbs=<stage:from->to,…>` and ` rung-drift=<name>` when they apply; '' for a row with no rung."""
    rung = task.get("rung")
    if not isinstance(rung, str) or not rung:
        return ""
    out = f" rung={rung}"
    start = task.get("startRung")
    if isinstance(start, str) and start and start != rung:
        out += f" from={start}"
    climbs = task.get("climbs")
    if isinstance(climbs, list) and climbs:
        out += " climbs=" + ",".join(
            f"{c.get('stage')}:{c.get('from')}->{c.get('to')}" if isinstance(c, dict) else str(c) for c in climbs)
    drift = task.get("rungDrift")
    if isinstance(drift, str) and drift:
        out += f" rung-drift={drift}"
    return out


# ladder.py, shared with every skill: the operator's ladder, as the lead reads it at each Workflow call's start.
LADDER_PY = Path(__file__).resolve().parent.parent.parent / "_shared" / "scripts" / "ladder.py"


def _ladder():
    """The operator's ladder, read through ladder.py's load(): {source, rungs: [names, bottom first], error}.
    `error` is None when it reads. When it cannot be read (a refused file: LadderError, exit 2 or 3 from the
    CLI; or a ladder.py that will not load) `rungs` is [], `source` the path load() reads (ladder.py's
    default_path(), '' when ladder.py itself will not load) and `error` the CLI's own words without its
    `ladder: ` prefix: `<path>:<line>: <reason>`, or `<path>: <reason>` when no line applies."""
    mod = None
    try:
        spec = importlib.util.spec_from_file_location("thread_ladder", LADDER_PY)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        ladder = mod.load()
        return {"source": ladder["source"], "rungs": [r["name"] for r in ladder["rungs"]], "error": None}
    except Exception as e:  # any failure is the caller's ERROR or flag, never a guessed rung
        path = ""
        try:
            path = mod.default_path() if mod is not None else ""
        except Exception:
            pass
        reason = str(getattr(e, "reason", "") or e) or type(e).__name__
        line = getattr(e, "line", None)
        where = path if line is None else f"{path}:{line}"
        return {"source": path, "rungs": [], "error": f"{where}: {reason}" if where else reason}


def _ladder_top():
    """(top rung name, source) of the operator's ladder (_ladder()); (None, why) when it cannot be read."""
    ladder = _ladder()
    if ladder["error"]:
        return None, ladder["error"]
    return ladder["rungs"][-1], ladder["source"]


def _gate_bounce(task) -> str:
    """The plan judge's bounce paragraph (ADR 0038) in a row's blockerDiagnosis, from GATE_BOUNCE_MARK to the end,
    stripped; '' when the row has none. The mark counts only at the start of the diagnosis or of a paragraph, so a gate
    line that quotes it never does."""
    diag = task.get("blockerDiagnosis")
    m = GATE_BOUNCE_RE.search(diag.replace("\r\n", "\n")) if isinstance(diag, str) else None
    return m.group(1).strip() if m else ""


def _legacy_climb(task) -> str:
    """A pre-3.0.0 row's evidence of hardness (ADR 0029 compat): 'escalated' or 'tier-capped', '' for none.
    Only a row with no `rung` qualifies; every 3.0.0 row carries one (possibly '')."""
    if task.get("rung") is not None:
        return ""
    if task.get("escalated"):
        return "escalated"
    if task.get("tierCapped"):
        return "tier-capped"
    return ""


def cmd_reconcile(args) -> int:
    raw = sys.stdin.read() if args.result == "-" else Path(os.path.expanduser(args.result)).read_text()
    data = json.loads(raw)
    tasks = data.get("tasks", [])
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    now = _now(args)
    errors = []
    warnings = []
    top = None  # (name, source) of the ladder's top rung, read once, only for a pre-3.0.0 row
    for task in tasks:
        slug = task.get("slug", "<no-slug>")
        status = task.get("status")
        path = resolve_task_path(task, tasks_dir)
        if not path.exists():
            errors.append(f"{slug}: task note not found at {path}")
            continue
        if status not in ("review", "review-blocked", "blocked", "plan-blocked", GATE_PENDING_STATUS):
            errors.append(f"{slug}: unexpected workflow status {status!r} — left untouched")
            continue
        try:
            note = Note(path)
        except ValueError as e:
            errors.append(str(e))
            continue

        pr = (task.get("prUrl") or "").strip()
        # The Run record reads the note as it was before this row (p15-2): its status, whether it held the lane.
        prior, held, rollout = _status(note), _holds_lane(note), _note_rollout(note)
        lane_fields = _lane_fields_from_log(note) if held else {}
        ready_stamped = False
        # A read-only task is done when its review approves: nothing to merge, so it never enters
        # Integration (ADR 0030). The row's scope wins; the note's own is the fallback.
        scope = _scalar(task.get("scope")).lower() or _scope(note)
        note_status = "done" if (status == "review" and not pr and scope == "read-only") else status
        # `ready:` is when the task joined the Integration queue: the approving own (or seeded revise)
        # call returned (the engine's readyAt). Stamped on a move to review from another status,
        # overwriting any earlier value; never on a read-only task (it never enters Integration) and
        # never on an Integration row (an integrated set-aside re-entering review is leaving Integration,
        # not joining the queue).
        if (note_status == "review" and _status(note) != "review" and scope != "read-only"
                and task.get("integration") is None):
            note.set("ready", _stamp(now))
            ready_stamped = True
        note.set("status", note_status)
        # Its approval is its completion, so it is stamped `merged:` as a PR task is at its merge (the
        # first stamp wins): its duration then counts in the timeline, and a read-only task finishing
        # last ends the rollout's elapsed time.
        if note_status == "done" and not _scalar(note.get("merged")):
            note.set("merged", _stamp(now))
        # Whatever Integration this task was in, the run that produced this row ended it.
        note.remove("integrating")

        # The rung is durable (ADR 0029 decision 4): a task that climbed has proven non-mechanical, so
        # every later re-dispatch (resume, /thread:repair) starts on the rung it reached, not back at the
        # bottom. Stamped for every status, landed ones included, as the record of what it took; an
        # integrate row passes the task's own record through, and a neutral one (or a lead-written row)
        # carries no rung and stamps nothing. A drifted `rung:` (one the ladder lacks) is overwritten by
        # the rung the call reached. Idempotent via Note.set. Never a legacy stamp.
        rung = task.get("rung")
        legacy = _legacy_climb(task)
        legacy_note = ""
        if rung not in (None, ""):
            if is_rung_name(rung):
                note.set("rung", rung)
            else:
                errors.append(f"{slug}: rung {rung!r} is not a rung name ([a-z][a-z0-9._-]*, never a YAML word) — "
                              "no rung: stamped")
        elif legacy:
            # A call started before 3.0.0 finished on the tier engine (a Lost-call resume re-passes its old
            # scriptPath): its row has no rung record, only the tier flags. The old reconcile made that climb
            # durable (a legacy model or cap stamp); left unstamped, the re-dispatch would restart on the
            # bottom rung and re-pay it. The top rung is that climb's equivalent on the ladder.
            if top is None:
                top = _ladder_top()
            name, source = top
            if name:  # ladder.py's load() only returns rung names (tests/ladder.test.mjs L9)
                note.set("rung", name)
                legacy_note = f" rung={name} (pre-3.0.0 row, {legacy})"
                warnings.append(f"{slug}: a pre-3.0.0 row ({legacy}, no rung) — stamped rung: {name}, the top rung "
                                f"of the ladder ({source}), so its re-dispatch does not restart on the bottom rung")
            else:
                errors.append(f"{slug}: a pre-3.0.0 row ({legacy}, no rung) — the ladder could not be read ({source}), "
                              "so no rung: was stamped and its re-dispatch would restart on the bottom rung; fix "
                              "~/.config/thread/ladder.toml and re-run this reconcile")

        if status in STATUS_WITH_PR and pr:
            note.set("pr", pr)
        if status == "review":
            note.set("review_rounds_used", int(task.get("reviewRoundsUsed") or 0))
            plan_rounds = int(task.get("planRoundsUsed") or 0)
            if plan_rounds > 0:
                note.set("plan_rounds_used", plan_rounds)
            # Ceiling approval: persist the accumulated rejection rationale as a run (audit record; the
            # engine sets the flag only when there IS history — a clean first-try approve records
            # nothing). A re-reconcile of the same result is a no-op.
            if task.get("approvedAtCeiling"):
                history = history_block(task.get("reviewHistory"))
                if history:
                    note.append_run(REVIEW_HISTORY_SECTION, history, now)

        if status in SECTION_BY_STATUS:
            heading = SECTION_BY_STATUS[status]
            if status == "review-blocked":
                # Full grouped history when the engine provides it (review-loop memory) — the
                # re-dispatched agent treats this section as authoritative and must see every round,
                # not just the last. Legacy results (pre-2.0.3 engine) fall back to the final bullets.
                content = history_block(task.get("reviewHistory")) or bullets(task.get("reviewFeedback") or [])
            elif status == GATE_PENDING_STATUS:
                content = bullets(task.get("gatedInputs") or []) or (task.get("blockerDiagnosis") or "").strip()
            else:
                content = (task.get("blockerDiagnosis") or "").strip()
            if content:
                if status == GATE_PENDING_STATUS:
                    # Upsert, not append: a re-planned task may declare a DIFFERENT gate set (e.g. a
                    # revised cap) — the pending list must always be the latest declaration, never stale.
                    note.upsert_section(heading, content)
                else:
                    # p6-4: every run's feedback is kept as its own numbered run, never only the first.
                    note.append_run(heading, content, now)

        # ADR 0038: the plan judge's bounce rides beside the pending gates (upserted, like them), and any other row,
        # or a gate-pending row without one, settles an older one. Its presence is what keeps the standing approval off
        # this note's gates (_approve_standing).
        bounce = _gate_bounce(task) if status == GATE_PENDING_STATUS else ""
        if bounce:
            note.upsert_section(GATE_BOUNCE_SECTION, bounce)
        else:
            note.remove_section(GATE_BOUNCE_SECTION)

        # p12-16: an Integration row leaves one line in the note's `## Integration log` (the durable
        # record a cold lead, repair and the gate resume read). `integration: null` counts as absent.
        integration = task.get("integration")
        if isinstance(integration, dict):
            note.append_line(INTEGRATION_LOG_SECTION, _integration_log_line(task))
        elif integration is not None:
            errors.append(f"{slug}: integration is not an object ({type(integration).__name__}) — "
                          "no Integration log line written")

        # p14-2: the approved plan, settled only by the task's own call. A non-empty string is the plan its
        # own call ran with (upserted, quoted, below the lead-in); '' (or whitespace) is an own call with no
        # plan-gate, so an older plan is stale and removed; null or an absent key (a call that reached no plan
        # outcome, a seeded revise, an Integration row, a lead-written row) leaves the section as it is.
        plan = task.get("plan")
        if isinstance(plan, str) and plan.strip():
            note.upsert_section(APPROVED_PLAN_SECTION, APPROVED_PLAN_LEAD_IN + "\n\n" + quote_block(plan))
        elif isinstance(plan, str):
            note.remove_section(APPROVED_PLAN_SECTION)
        elif plan is not None:
            errors.append(f"{slug}: plan is not a string or null ({type(plan).__name__}) — "
                          f"{APPROVED_PLAN_SECTION} left untouched")

        # p16-3: the question a person must answer, the same three states as the plan. A non-empty string is the
        # question this row stopped on (upserted, neutralised by upsert_section, so it can never split the
        # section); '' (or whitespace) is a row with no question, so an older one is settled and removed; null or
        # an absent key (an integrate row, a lead-written set-aside row) leaves the section as it is.
        ask = task.get("needsHuman")
        if isinstance(ask, str) and ask.strip():
            note.upsert_section(NEEDS_HUMAN_SECTION, ask.strip())
        elif isinstance(ask, str):
            note.remove_section(NEEDS_HUMAN_SECTION)
        elif ask is not None:
            errors.append(f"{slug}: needsHuman is not a string or null ({type(ask).__name__}) — "
                          f"{NEEDS_HUMAN_SECTION} left untouched")

        note.save(dry_run=args.dry_run)
        _reconcile_events(args, rollout, slug, task, note, prior, held, lane_fields, note_status, _pr(note),
                          ready_stamped)
        _review_verdict_events(args, rollout, slug, task, prior)
        flag = " (dry-run)" if args.dry_run else (" [written]" if note.dirty else " [no-change]")
        ro = " (read-only, approved)" if note_status != status else ""
        print(f"{slug}: status={note_status}{ro}{(' pr=' + pr) if pr else ''}{_rung_note(task)}{legacy_note}{flag}")

    for w in warnings:
        print(f"WARNING: {w}", file=sys.stderr)
    for e in errors:
        print(f"ERROR: {e}", file=sys.stderr)
    return 1 if errors else 0


# ---- the Trickle and Away (Chorus ADR 0104 d2, d3, d6; execute away.md) ----------------------------------------

AWAY_FILE_REL = ".config/thread/away.json"                    # under the home dir, resolved at call time
AWAY_KEYS = ("away", "until", "morning", "trickle", "written_at")  # all required, in away.md's key-table order
DEFAULT_TRICKLE = 2                                            # missing, stale or unreadable: not Away, at this
AWAY_STALE_AFTER = timedelta(hours=24)                         # a written_at older than this reads stale
AWAY_FUTURE_SKEW = timedelta(minutes=5)                        # a written_at further ahead than this reads stale
AWAY_MAX_BYTES = 64 * 1024
MORNING_RE = re.compile(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]\Z", re.ASCII)
AWAY_WARN = "WARN: ~/.config/thread/away.json"                 # the stale / unreadable stderr line's prefix
TRICKLE_PREFIX = "trickle:"                                    # a row held for want of a Trickle Slot


def _away_stamp(value):
    """(aware datetime, None) for an ISO 8601 stamp with an offset or `Z`, else (None, why). A naive stamp is refused
    as ambiguous: the writer and the reader may not share a time zone."""
    if not isinstance(value, str):
        return None, "not a string"
    s = value.strip()
    if s[-1:] in ("Z", "z"):
        s = s[:-1] + "+00:00"
    try:
        ts = datetime.fromisoformat(s)
    except ValueError:
        return None, "not an ISO 8601 stamp"
    if ts.tzinfo is None:
        return None, "naive (no offset or Z)"
    return ts, None


def _away_read(path: Path):
    """(file, why, data) for the state file at `path`: file is missing, unreadable or ok (data the parsed object)."""
    try:
        with open(path, "rb") as f:
            raw = f.read(AWAY_MAX_BYTES + 1)
    except (FileNotFoundError, NotADirectoryError):
        return "missing", "no file", None
    except OSError as e:
        return "unreadable", f"cannot read it ({e.strerror or type(e).__name__})", None
    if len(raw) > AWAY_MAX_BYTES:
        return "unreadable", "over 64 KiB", None
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return "unreadable", "not UTF-8", None
    try:
        data = json.loads(text)
    except ValueError:
        return "unreadable", "not JSON", None
    if not isinstance(data, dict):
        return "unreadable", "not a JSON object", None
    for key in AWAY_KEYS:  # the first problem, in key-table order; extra keys are ignored
        if key not in data:
            return "unreadable", f"no `{key}`", None
        why = _away_field(key, data[key])
        if why:
            return "unreadable", f"`{key}` {why}", None
    return "ok", None, data


def _away_field(key, value):
    """None when one of AWAY_KEYS holds a well-typed value, else what is wrong with it (away.md's key table)."""
    if key == "away":
        return None if isinstance(value, bool) else "is not a JSON boolean"
    if key in ("until", "written_at"):
        why = _away_stamp(value)[1]
        return f"is {why}" if why else None
    if key == "morning":
        return None if isinstance(value, str) and MORNING_RE.match(value) else 'is not "HH:MM" (00:00 to 23:59)'
    # trickle: a JSON integer of at least 1; a bool, a float, a string or 0 is refused (the Trickle is never 0)
    return None if not isinstance(value, bool) and isinstance(value, int) and value >= 1 else \
        "is not a JSON integer of at least 1"


def _away_state(now) -> dict:
    """The Away state `next` reads (execute away.md § Reading it): {away, file, why, limit, until, morning}. `file` is
    fresh, missing, stale or unreadable; `why` is null only when fresh. Anything but fresh reads not Away at
    DEFAULT_TRICKLE, and a stale file's own `trickle` is ignored. Stale is any of: `until` <= now; now - `written_at`
    over 24 h; `written_at` more than 5 minutes after now. `until` and `morning` are the file's, reported only when
    fresh. The path is the home dir's at call time (a pinned HOME is the only override)."""
    out = {"away": False, "file": "missing", "why": None, "limit": DEFAULT_TRICKLE, "until": None, "morning": None}
    file, why, data = _away_read(Path.home() / AWAY_FILE_REL)
    if data is None:
        out.update(file=file, why=why)
        return out
    until = _away_stamp(data["until"])[0]
    written = _away_stamp(data["written_at"])[0]
    if until <= now:
        why = f"until {data['until']} has passed"
    elif now - written > AWAY_STALE_AFTER:
        why = f"written_at {data['written_at']} is over 24 h old"
    elif written - now > AWAY_FUTURE_SKEW:
        why = f"written_at {data['written_at']} is more than 5 minutes ahead of now"
    if why:
        out.update(file="stale", why=why)
        return out
    out.update(away=data["away"], file="fresh", limit=data["trickle"], until=data["until"], morning=data["morning"])
    return out


def _elsewhere_running(rollout_path: Path, tasks_dir: Path, index) -> dict:
    """{<rollout stem>: n} for every other open, started, parallel Rollout on the Mac running n > 0 tasks, sorted (execute
    away.md § The Trickle). `index` is _scan's, one walk of `tasks_dir`. A rollout note counts only when it sits directly
    in `tasks_dir` (never under Archive/), is tagged `rollout`, is not done or dropped, reads parallel, carries no
    `paused:` stamp, is not this rollout, and has started (never_started over the index notes whose `rollout:` names
    it). Its n is those notes at `status: in_progress`, less the ones its own undecided RACE or UNVERIFIED holds
    (_race_holds): such a task never restarts, so it holds no Slot. Review and integrating notes never count (Integration
    holds no Slot), nor does a serial rollout's Leg."""
    this = rollout_path.resolve()
    by_rollout = {}
    for path, note in index.values():
        target = (_wikilink_slug(note.get("rollout")) or "").lower()
        if target:
            by_rollout.setdefault(target, []).append((path, note))
    out = {}
    for path, note in index.values():
        if path.parent != tasks_dir or "rollout" not in _tags(note) or _status(note) in CLOSED_ROLLOUT_STATUSES:
            continue
        if _shape(note) != "parallel" or _valued(note.get("paused")) or path.resolve() == this:
            continue
        linked = by_rollout.get(path.stem.lower(), [])
        if never_started(note, linked)[0]:
            continue
        held = _race_holds(note, linked)
        n = sum(1 for p, t in linked if _status(t) == "in_progress" and p.stem.lower() not in held)
        if n > 0:
            out[path.stem] = n
    return dict(sorted(out.items()))


# ---- next -------------------------------------------------------------------

def _set_aside_entry(r) -> dict:
    """One `next` setAside entry: slug, status, setAsideAt, and `needsHuman` (p16-3) only when the note holds an
    open question, so an entry with none is byte-identical to the pre-p16-3 output."""
    entry = {"slug": r["slug"], "status": r["status"], "setAsideAt": r["setAsideAt"]}
    ask = needs_human(r["note"])
    if ask:
        entry["needsHuman"] = ask
    return entry


def _ceremony_done(rollout_path: Path, rollout_note) -> bool:
    """True when the rollout's completion ceremony already ran through its archive move (p19-14): the note
    reads `status: done` and sits in an `Archive/Rollouts/` directory, where that move puts it, the step before
    the ceremony's last (the thread close, which the lead's `done` route still runs: nothing on disk says it
    ran). `next` then halts "done", never "complete", so no entry (repair's hand-off included) runs the rest of
    the ceremony a second time. A done note still in Work/Tasks/ is an interrupted ceremony (stamped, never
    moved), so it stays "complete" and a re-entry finishes it. The path is made absolute first, so a relative
    `--rollout` given from inside the archive still reads."""
    parent = rollout_path.absolute().parent
    return (_status(rollout_note) == "done"
            and parent.name == "Rollouts" and parent.parent.name == "Archive")


def cmd_next(args) -> int:
    """Which tasks start now (ADR 0030 decision 1). Pure function of the notes, except for two writes to the rollout
    note off --dry-run: a drained soft pause is stamped (`paused:`) here, and once the refusals pass the rollout start
    stamp (`start: unattended`, _clear_start) is removed (`startCleared`); one call can make both. New starts are
    picked greedily by `priority:`, then least file overlap with what is in flight, then schedule rank, among the
    queued tasks ranked above the head Solo task (the first queued Solo task by rank whose dependencies are met,
    p17-2); that task holds every task ranked below it, whatever their
    `priority:` (each held `behind solo [[<head>]]`, a full ceiling included: only the head and the rows above it
    wait on `ceiling:`), and starts only when nothing else has started. A task an undecided RACE or UNVERIFIED holds
    (_race_holds) and that has not landed is re-read as set-aside at `race`: it never starts, restarts or
    integrates, is never a seeded revise (those are set aside at `run`), and its dependants wait. One whose
    `integrating:` stamp stands (the lead's RACE re-verify holds the lane on it) still counts as integrating
    everywhere else: a soft pause is not stamped past it, a solo waits for it, its files count as in flight, and no
    halt is reported while it stands. `raceHold` lists each, in rank order, with its kind; the counts and the
    progress line are the re-read rows'. `awaitingIntegration` is the Integration queue's order: a task a queued
    task depends on, directly or through a folded member (`merged_into:`), first, then the oldest `ready:`, then
    schedule order (_lane_key). An unacked git-env trip (_git_env_hold) is listed under `gitEnvHold`, and
    while it stands nothing starts or restarts, every stalled or queued task is held (`git-env hold:
    /thread:repair`) and `halt` is "git-env", ahead of every other verdict. The Trickle (Chorus ADR 0104; execute
    away.md): once the refusals pass, the Away state file is read (_away_state; a stale or unreadable one prints one
    AWAY_WARN line on stderr) and every other started parallel Rollout's running tasks are counted (_elsewhere_running).
    Away, `slotLimit` is the ceiling; not Away, it is min(ceiling, max(0, Trickle - the count elsewhere)). Starts and the
    head Solo's lone start stop at `slotLimit`, counting every in_progress row of this rollout, live or stalled, as the
    count elsewhere does; a restart stops at the ceiling only, since every other lead already counts the task it takes
    back. A running call is never stopped, so `slotsInUse` may exceed `slotLimit`. A row held for want of a Slot reads
    `ceiling: …` once this rollout fills its ceiling, else `trickle: <trickle.running>/<Trickle> tasks running on this
    Mac`, and a `trickle:` hold never lets the rollout halt."""
    rollout_path = Path(os.path.expanduser(args.rollout))
    if not rollout_path.exists():
        print(f"ERROR: rollout note not found at {rollout_path}", file=sys.stderr)
        return 1
    now = _now(args)
    rollout_note = Note(rollout_path)
    if _shape(rollout_note) == "serial":
        print(f"ERROR: {rollout_path.stem}: shape: serial: a serial rollout runs as Legs, never through next: "
              f"/thread:execute [[{rollout_path.stem}]] runs its next Leg (execute legs.md)", file=sys.stderr)
        return 1
    ceiling, err = _ceiling(rollout_note)
    if err:
        print(f"ERROR: {rollout_path.stem}: {err}", file=sys.stderr)
        return 1
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    rows, index = _rows(rollout_path, rollout_note, tasks_dir)
    why = incomplete(rollout_path, rollout_note, [(r["path"], r["note"]) for r in rows], index)
    if why:
        project = next((s for s in (_wikilink_slug(v) for v in rollout_note.get_list("projects")) if s), "<project>")
        print(f"ERROR: {rollout_path.stem} is incomplete: {why}: never run it as written; supersede it with "
              f"/thread:schedule {project} --regenerate", file=sys.stderr)
        return 1
    # The start stamp (START_KEY): reported as read at this call; the lead's call (not --dry-run) removes it, since a
    # lead now runs the rollout. Every refusal above returned first, so a refused call leaves it for the Stage.
    start_unattended = _start_unattended(rollout_note)
    start_cleared = False
    # The Trickle (Chorus ADR 0104; execute away.md), read once the refusals pass, so a refused call never warns. A
    # stale or unreadable file warns on every call, --dry-run included; a missing one is the documented default.
    away = _away_state(now)
    if away["file"] in ("stale", "unreadable"):
        print(f"{AWAY_WARN} {away['file']}: {away['why']} — read as not Away, Trickle {DEFAULT_TRICKLE}",
              file=sys.stderr)
    elsewhere = _elsewhere_running(rollout_path, tasks_dir, index)
    running_elsewhere = sum(elsewhere.values())
    slot_limit = ceiling if away["away"] else min(ceiling, max(0, away["limit"] - running_elsewhere))
    race = _race_holds(rollout_note, [(r["path"], r["note"]) for r in rows])
    # race_held_lane: a held task whose `integrating:` stamp stands. The lead's RACE re-verify still holds the
    # lane on it, so it stays in flight for the drain, the solo rule, the overlap and the halt verdict; the
    # re-read only keeps it out of `integrating` (never integrated again) and out of every start.
    race_hold, race_held_lane = [], []
    for r in sorted(rows, key=_rank):
        held = race.get(r["slug"].lower())
        if held and not _landed(r["note"]):
            if r["state"] == "integrating":
                race_held_lane.append(r)
            r["state"], r["setAsideAt"] = "set-aside", "race"
            race_hold.append({"slug": r["slug"], "kind": held[1]})
    by_state = {}
    for r in sorted(rows, key=_rank):
        by_state.setdefault(r["state"], []).append(r)
    in_progress = by_state.get("running", [])
    awaiting = by_state.get("awaiting-integration", [])
    integrating = by_state.get("integrating", [])
    queued = by_state.get("queued", [])

    # Live vs stalled. With no --running, every in_progress note is running: it holds a slot and is
    # never restarted, so a live lead and /thread:status agree. With --running, only the listed slugs
    # are live; every other in_progress note is stalled and restarts ahead of new starts.
    if args.running is None:
        live, stalled = in_progress, []
    else:
        want = {(_wikilink_slug(s) or "").lower() for s in args.running.split(",") if s.strip()}
        live = [r for r in in_progress if r["slug"].lower() in want]
        stalled = [r for r in in_progress if r["slug"].lower() not in want]
        known = {r["slug"].lower() for r in in_progress}
        for s in sorted(want - known):
            print(f"WARN: --running {s}: not an in_progress task of this rollout — ignored", file=sys.stderr)

    paused = _scalar(rollout_note.get("paused")) or None
    pause_requested = _truthy_flag(rollout_note.get("pause_requested"))
    paused_now = False
    # slot_held: rows held for want of a Slot, at the ceiling or (not Away) the Trickle; their reason is set below.
    start, restart, holds, slot_held = [], [], [], []
    used = len(live)
    # mine: this rollout's own use of the Trickle before this call's starts, every in_progress row, live or stalled, as
    # every other lead counts it (_elsewhere_running). A new start fits only while mine + starts < slot_limit.
    mine = len(in_progress)

    if paused or pause_requested:
        # A soft pause drains (ADR 0030 decision 5): nothing new starts or restarts; once nothing runs,
        # awaits Integration or integrates (a held RACE re-verify included), the pause is stamped and the
        # request removed.
        if not paused and not live and not awaiting and not integrating and not race_held_lane:
            paused = _stamp(now)
            rollout_note.set("paused", paused, after=("pause_requested", "parallel_ceiling", "status"))
            rollout_note.remove("pause_requested")
            rollout_note.save(dry_run=args.dry_run)
            paused_now = True
            _event(rollout_path.stem, "paused", None, {"mode": "soft"}, args)
        reason = "paused" if paused else "pause requested: draining"
        holds += [(r, reason) for r in stalled + queued]
    else:
        # A restart takes back a task every other lead already counts (its note stays in_progress), so only the
        # ceiling bounds it, never the Trickle: bounding it there would let two respawned leads each wait on the other's
        # stalled notes with nothing running (execute away.md § The Trickle).
        for r in sorted(stalled, key=lambda r: (-r["weight"], r["rank"])):
            if used < ceiling:
                restart.append(r)
                used += 1
            else:
                slot_held.append(r)
        started = live + restart + awaiting + integrating + race_held_lane
        candidates = []
        for r in queued:
            unsat = _unsatisfied(r, index)
            if unsat:
                holds.append((r, "; ".join(unsat)))
            else:
                candidates.append(r)
        solo_started = next((r for r in sorted(started, key=_rank) if r["solo"]), None)
        if solo_started:
            holds += [(r, f"behind solo [[{solo_started['slug']}]]") for r in candidates]
        else:
            in_flight = {f for r in started for f in r["files"]}
            remaining = list(candidates)
            # The head Solo task (p17-2): the first queued Solo task by rank whose dependencies are met. It holds
            # every task ranked below it, whatever their priority:, so priority and overlap order only the rows
            # above it. A Solo task its dependency holds is no candidate, so it holds nothing.
            solo_head = min((r for r in remaining if r["solo"]), key=_rank, default=None)
            while remaining:
                above = [r for r in remaining if solo_head is None or r["rank"] < solo_head["rank"]]
                best = (min(above, key=lambda r: (-r["weight"], _overlap(r["files"], in_flight), r["rank"]))
                        if above else solo_head)
                if best["solo"]:
                    remaining.remove(best)
                    if not started and not start and mine + len(start) < slot_limit:
                        start.append(best)
                    elif not started and not start:
                        slot_held.append(best)  # nothing of this rollout runs: only the Trickle holds it
                    else:
                        holds.append((best, f"solo: waits for {len(started) + len(start)} started task(s) "
                                            f"to merge or be set aside"))
                    holds += [(r, f"behind solo [[{best['slug']}]]") for r in remaining]
                    break
                if mine + len(start) >= slot_limit:  # the ceiling binds through it: used <= mine, slot_limit <= ceiling
                    # A freed slot goes to a row above the head Solo task, or to that task, never to a row below
                    # it: those wait behind it, as status's Queued row says, and only the rest wait on a Slot.
                    for r in remaining:
                        if solo_head is not None and r["rank"] > solo_head["rank"]:
                            holds.append((r, f"behind solo [[{solo_head['slug']}]]"))
                        else:
                            slot_held.append(r)
                    break
                start.append(best)
                remaining.remove(best)
                in_flight.update(best["files"])
    in_use = used + len(start)
    # Whichever binds first names the reason: the ceiling once this rollout fills it, else the Trickle, counted as
    # `trickle.running` is (no quotes, so it can ride a ROLLOUT-STATUS reason=). A stalled row is only ever held at the
    # ceiling, which it fills first.
    slot_why = (f"ceiling: {in_use}/{ceiling} slots in use" if in_use >= ceiling else
                f"{TRICKLE_PREFIX} {running_elsewhere + mine + len(start)}/{away['limit']} tasks running on this Mac")
    holds += [(r, slot_why) for r in slot_held]
    if not args.dry_run:
        start_cleared = _clear_start(rollout_note)
        rollout_note.save()

    # An unacked git-env trip (execute § 4.5 *Git-env canary*) holds the whole queue until /thread:repair records
    # Lachy's ack: nothing starts or restarts, every stalled or queued task is held, and the halt is "git-env",
    # ahead of every other verdict (a live call or a held lane included: the lead halts at once).
    git_env = _git_env_hold(rollout_note)
    if git_env:
        start, restart = [], []
        used = len(live)
        holds = [(r, "git-env hold: /thread:repair") for r in stalled + queued]
    in_n = [r for r in rows if r["state"] not in OUTSIDE_N]
    counts = _counts(rows)
    halt = None
    sign_off = []
    # A row the Trickle holds could start once the Mac has room, so it never halts the rollout (D6 of p28-1): the
    # lead waits (§ 4.5 step 1.6) instead of reading stuck or awaiting-sign-off.
    trickle_held = any(why.startswith(TRICKLE_PREFIX) for _, why in holds)
    if git_env:
        halt = "git-env"
    elif not start and not restart and not live and not awaiting and not integrating and not race_held_lane \
            and not trickle_held:
        if paused:
            halt = "paused"
        elif not in_n:
            halt = "empty"
        elif counts["merged"] == counts["total"]:
            halt = "done" if _ceremony_done(rollout_path, rollout_note) else "complete"
        else:
            # ADR 0034: a gate alone never halts `stuck`. When every unlanded task waits only on a gate (W), the
            # verdict is awaiting-sign-off: execute's step 5 runs its sign-off form and the rollout closes.
            sign_off = _sign_off_wait(rows, index)
            halt = "awaiting-sign-off" if sign_off else "stuck"
    # The Run record (p15-2): a reason marker for the idle Slots this call leaves (none at complete, done or empty).
    free = ceiling - (used + len(start))
    if free > 0 and halt not in ("complete", "done", "empty") and not args.dry_run:
        reason = _idle_reason(git_env, paused, pause_requested, holds, queued, start, race_hold,
                              by_state.get("set-aside", []), trickle_held)
        _event(rollout_path.stem, "idle-slots", None,
               {"reason": reason, "free": free, "settings": _rollout_settings(rollout_note, ceiling)}, args)
    slugs = lambda rs: [r["slug"] for r in rs]  # noqa: E731
    # The Integration queue's order (_lane_key); `awaiting` itself stays in rank order for everything above. A
    # dependency on a folded member waits on its combined unit (_fold_unit), as its hold reason already says.
    waited = {_fold_unit(d, index)[0].lower() for r in queued for d in r["deps"]}
    out = {
        "rollout": rollout_path.stem,
        "ceiling": ceiling,
        "slotsInUse": used,
        "slotLimit": slot_limit,
        "trickle": {"away": away["away"], "file": away["file"], "why": away["why"], "limit": away["limit"],
                    "until": away["until"], "morning": away["morning"], "elsewhere": elsewhere,
                    # The Trickle's count of the Mac after this call: the count elsewhere plus this rollout's own use.
                    "running": running_elsewhere + mine + len(start)},
        "start": slugs(start),
        "restart": slugs(restart),
        "hold": [{"slug": r["slug"], "reason": why} for r, why in sorted(holds, key=lambda h: _rank(h[0]))],
        "running": slugs(live),
        "awaitingIntegration": slugs(sorted(awaiting, key=lambda r: _lane_key(r, waited))),
        "integrating": slugs(integrating),
        "setAside": [_set_aside_entry(r) for r in by_state.get("set-aside", [])],
        "raceHold": race_hold,
        "gitEnvHold": git_env,
        "paused": paused,
        "pauseRequested": pause_requested,
        "pausedNow": paused_now,
        "startUnattended": start_unattended,
        "startCleared": start_cleared,
        "halt": halt,
        "awaitingSignOff": sign_off,
        "progress": _progress_line(counts, _timeline(rows, counts, ceiling, now)),
    }
    print(json.dumps(out, indent=2))
    return 0


def _sign_off_wait(rows, index):
    """W, the tasks that wait only on a gate (ADR 0034; the module docstring's `next`): [{slug, why}] in rank order,
    or [] unless W is non-empty and equals the rollout's unlanded in-N rows. `rows` are `next`'s, race holds already
    re-read (a race-held row reads set-aside at `race`, so it never joins W). W starts as the set-aside rows at `gate`
    (why "gate-pending") and gains, to a fixpoint, each queued row whose every unsatisfied dependency resolves through
    _fold_unit to a unit already in W (why "depends on [[<that unit>]]")."""
    unlanded = {r["slug"].lower(): r for r in rows if r["state"] not in OUTSIDE_N and r["state"] != "merged"}
    wait = {k: "gate-pending" for k, r in unlanded.items() if r["state"] == "set-aside" and r["setAsideAt"] == "gate"}
    if not wait:
        return []
    grew = True
    while grew:
        grew = False
        for k, r in unlanded.items():
            if k in wait or r["state"] != "queued":
                continue
            units = [_fold_unit(d, index)[0] for d in r["deps"] if not _dep_status(d, index)[0]]
            if units and all(u.lower() in wait for u in units):
                wait[k] = f"depends on [[{units[0]}]]"
                grew = True
    if set(wait) != set(unlanded):
        return []
    return [{"slug": r["slug"], "why": wait[k]} for k, r in sorted(unlanded.items(), key=lambda kr: _rank(kr[1]))]


def _awaits_sign_off(rollout_path: Path, rollout_note, tasks_dir: Path):
    """`next`'s awaiting-sign-off verdict, read-only, as `next` with no --running and any pause ignored would give it:
    no git-env hold; nothing running (every in_progress note counts as live), awaiting Integration or integrating (a
    race-held lane included); no queued task free to start; then _sign_off_wait. Returns (W, rows): W [] when the queue
    is anything else. Read by await-sign-off and clear-pause; it writes nothing."""
    rows, index = _rows(rollout_path, rollout_note, tasks_dir)
    if _git_env_hold(rollout_note):
        return [], rows
    race = _race_holds(rollout_note, [(r["path"], r["note"]) for r in rows])
    for r in rows:
        if race.get(r["slug"].lower()) and not _landed(r["note"]):
            if r["state"] == "integrating":
                return [], rows
            r["state"], r["setAsideAt"] = "set-aside", "race"
    if any(r["state"] in ("running", "awaiting-integration", "integrating") for r in rows):
        return [], rows
    if any(r["state"] == "queued" and not _unsatisfied(r, index) for r in rows):
        return [], rows
    return _sign_off_wait(rows, index), rows


# ---- per-task stamps ----------------------------------------------------------

def _each_note(args):
    """Yield (slug, path, Note) for --tasks, collecting not-found / unparseable errors in args._errors."""
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    args._errors = []
    for slug in [s.strip() for s in args.tasks.split(",") if s.strip()]:
        path = tasks_dir / f"{slug}.md"
        if not path.exists():
            args._errors.append(f"{slug}: task note not found at {path}")
            continue
        try:
            yield slug, path, Note(path)
        except ValueError as e:
            args._errors.append(str(e))


def _finish(args, now) -> int:
    _print_progress(args, now)
    for e in args._errors:
        print(f"ERROR: {e}", file=sys.stderr)
    return 1 if args._errors else 0


def _flag(args, note) -> str:
    return " (dry-run)" if args.dry_run else (" [written]" if note.dirty else " [no-change]")


GIT_ENV_CANARY_PY = Path(__file__).resolve().parent / "git-env-canary.py"


def _is_kind(path, kind) -> bool:
    """kind(st_mode) (stat.S_ISDIR, stat.S_ISREG) for path, False when it is missing; any other OSError raises, so
    the caller can fail closed. os.stat, never Path.is_dir()/is_file(): from Python 3.14 those return False on any
    OSError, EACCES included, so a path that cannot be stat'ed would read as missing (p26-3)."""
    try:
        return kind(os.stat(path).st_mode)
    except (FileNotFoundError, NotADirectoryError, ValueError):  # ValueError: an embedded NUL, a path none can hold
        return False


def _arm_task_window(args, slug, rollout_path) -> int:
    """mark-started's arm (p26-3): `git-env-canary.py arm --kind task` as a subprocess, so the canary keeps its own
    lock, git-env scrub and exit codes; its stdout and stderr pass through. An OSError or a signal counts as 2."""
    cmd = [sys.executable, str(GIT_ENV_CANARY_PY), "arm", "--rollout", str(rollout_path),
           "--tasks-dir", str(Path(os.path.expanduser(args.tasks_dir))), "--repo", args.arm_repo,
           "--default", args.arm_default, "--slug", slug, "--kind", "task"]
    sys.stdout.flush()
    sys.stderr.flush()
    try:
        rc = subprocess.run(cmd, stdin=subprocess.DEVNULL).returncode
    except OSError as e:
        print(f"git-env-canary: cannot run {GIT_ENV_CANARY_PY}: {e}", file=sys.stderr)
        return 2
    return 2 if rc < 0 else rc


def _arm_gate(args, slug, rollout, cache):
    """mark-started's arm decision for one note (p26-3): (rollout note path to arm against, or None to arm nothing;
    the refusal, or None). The flags are required while the rollout note's Project root names an existing directory,
    or while the note exists but cannot be read (fail-closed); given, they need a rollout note to arm against."""
    flags = args.arm_repo is not None
    if not rollout:
        return None, (f"{slug}: --arm-repo/--arm-default given, but the note has no rollout: — no rollout note to arm "
                      "against; nothing written") if flags else None
    path, rollout_note, _why, unreadable = _rollout_note_read(args, rollout, cache)
    if rollout_note is None and not unreadable:
        return None, (f"{slug}: --arm-repo/--arm-default given, but there is no rollout note at {path} — no rollout "
                      "note to arm against; nothing written") if flags else None
    if flags:
        return path, None
    if unreadable:
        return None, (f"{slug}: the rollout note {path} cannot be read, so mark-started cannot tell whether it must "
                      "arm the task window: pass --arm-repo <repoPath> --arm-default <B> (execute § 4.5 *Git-env "
                      "canary*, p26-3); nothing written")
    root = _project_root(rollout_note)
    try:
        required, said = root is not None and _is_kind(root, stat.S_ISDIR), "exists"
    except OSError as e:  # a root that cannot be stat'ed may exist: fail closed
        required, said = True, f"cannot be stat'ed ({e.strerror or e}) and may exist"
    if required:
        return None, (f"{slug}: the rollout's Project root {root} {said}, so mark-started arms the task window: pass "
                      "--arm-repo <repoPath> --arm-default <B> (execute § 4.5 *Git-env canary*, p26-3); nothing "
                      "written")
    return None, None


def cmd_mark_started(args) -> int:
    """Stamp `started:` as a task starts (first start wins: a restart keeps the first clock) and
    remove `integrating:`. Consumes approve-gates' `gates_signed:` marker (p12-14): the restart that
    directly follows a sign-off says so, once, and no later restart does. Refuses a done, merged or
    dropped note. Arms the task window first (p26-3, _arm_gate): a failed arm writes nothing for that
    note. Records slot-taken (p15-2), its start read before the markers are removed."""
    if (args.arm_repo is None) != (args.arm_default is None):
        print("ERROR: mark-started: --arm-repo <repoPath> and --arm-default <B> go together (p26-3); nothing written",
              file=sys.stderr)
        return 2
    now = _now(args)
    rollouts = {}
    worst = 0  # 3 an arm's trip or hold, 2 an arm failure or a flag refusal (D5)
    for slug, _path, note in _each_note(args):
        status = _status(note)
        if status in FINISHED_STATUSES:
            args._errors.append(f"{slug}: status is {status!r} — refusing to mark started")
            continue
        rollout, start = _note_rollout(note), _start_kind(note, args.start)  # read before the writes
        arm_path, refusal = _arm_gate(args, slug, rollout, rollouts)
        if refusal:
            args._errors.append(refusal)
            worst = max(worst, 2)
            continue
        if arm_path is not None:
            if args.dry_run:
                print(f"{slug}: would arm the task window (dry-run)")
            else:
                arc = _arm_task_window(args, slug, arm_path)
                if arc != 0:
                    args._errors.append(f"{slug}: the task window's arm exited {arc}; nothing written")
                    worst = max(worst, 3 if arc == 3 else 2)
                    continue
        existing = _scalar(note.get("started"))
        if not existing:
            note.set("started", _stamp(now))
        note.remove("integrating")
        signed = _scalar(note.get(GATES_SIGNED_KEY))
        note.remove(GATES_SIGNED_KEY)
        descoped = _scalar(note.get(DESCOPE_ARMED_KEY))
        note.remove(DESCOPE_ARMED_KEY)
        note.remove(HANDED_BACK_KEY)
        note.save(dry_run=args.dry_run)
        print(f"{slug}: started={existing or _stamp(now)}{' (kept)' if existing else ''}{_flag(args, note)}")
        if signed:
            print(f"{slug}: signed-gate restart (gates signed {signed}; {GATES_SIGNED_KEY}: cleared) — "
                  "a fresh call, not a resume of its gate-pending call, prints execute § 3.7's warning first")
        if descoped:
            print(f"{slug}: descope restart (descoped {descoped}; {DESCOPE_ARMED_KEY}: cleared) — a block after this "
                  "restart asks Lachy")
        sys.stdout.flush()
        _record_slot_taken(args, slug, note, rollout, start, rollouts)
    return max(worst, _finish(args, now))  # 3 > 2 > 1 (a refused note) > 0


def cmd_mark_integrating(args) -> int:
    """Stamp `integrating:` as a task's Integration begins (the first wins). Only a `review` note
    with a `pr:` can be integrating; anything else is refused."""
    now = _now(args)
    for slug, _path, note in _each_note(args):
        status = _status(note)
        if status != "review" or not _pr(note):
            args._errors.append(f"{slug}: status is {status!r}{'' if _pr(note) else ' with no pr:'}, "
                                f"not 'review' with a PR — refusing to mark integrating")
            continue
        existing = _scalar(note.get("integrating"))
        if not existing:
            note.set("integrating", _stamp(now))
        note.save(dry_run=args.dry_run)
        _event(_note_rollout(note), "lane-taken", slug, None, args)
        print(f"{slug}: integrating={existing or _stamp(now)}{' (kept)' if existing else ''}{_flag(args, note)}")
    return _finish(args, now)


def cmd_mark_done(args) -> int:
    """review -> done once the task's merge is confirmed; stamps `merged:` on a PR task (first wins)
    and removes `integrating:`. Read-only tasks never need it: reconcile writes them done on approval
    (a legacy read-only note still at review is flipped like any other)."""
    now = _now(args)
    for slug, _path, note in _each_note(args):
        status = note.get("status")
        if _status(note) == "done":
            print(f"{slug}: already done [no-change]")
            continue
        if _status(note) != "review":
            # Only a `review` note is "landed, awaiting confirmation". Anything else means the
            # caller's picture of the rollout is stale — refuse rather than mask a blocked/unmerged task.
            args._errors.append(f"{slug}: status is {status!r}, not 'review' — refusing to mark done")
            continue
        held, lane_fields = _holds_lane(note), _lane_fields_from_log(note)  # read before the flip
        note.set("status", "done")
        if _pr(note) and not _scalar(note.get("merged")):
            note.set("merged", _stamp(now))
        note.remove("integrating")
        note.save(dry_run=args.dry_run)
        _landed_events(_note_rollout(note), slug, held, lane_fields, _pr(note), args)
        print(f"{slug}: status=done" + (" (dry-run)" if args.dry_run else " [written]"))
    return _finish(args, now)


# ---- hand-back and log-integration (the lead's, p12-9) -------------------------------------------

# review-blocked, blocked, plan-blocked; and review, which _queue_state sets aside at its run only for a
# code-writing note approved without a pr: (a review note with a PR awaits Integration; a read-only one is done).
HAND_BACK_RUN_STATUSES = set(BLOCKED_SECTIONS) | {"review"}
SHA40_RE = re.compile(r"[0-9a-f]{40}")


def _race_hold_line(verb, slug, kind, ro) -> str:
    """The ERROR line hand-back and auto-retry print for a task an undecided RACE or UNVERIFIED holds."""
    return (f"{verb}: [[{slug}]] {kind} undecided: no \"repair: [[{slug}]] RACE decided:\" line on {ro}: record "
            f"Lachy's decision first with /thread:repair [[{ro}]]; nothing written")


def _hand_back_note(note, now):
    """hand-back's transition of one note, in memory (the caller saves it): (arm, said). Set aside at Integration
    with a pr: -> review, `ready:` restamped and `integrating:` removed (arm "integration"); a blocked,
    review-blocked or plan-blocked note set aside at its run, or a PR-less code-writing review note -> in_progress,
    `owner:` removed and `handed_back: <now>` stamped (arm "run": the restart's mark-started consumes the marker and
    records start=hand-back). Anything else is (None, why) and the note is untouched. `said` is the stdout tail
    after `<slug>: `. Shared by cmd_hand_back and cmd_auto_retry (p16-4), so the two re-enter a task identically."""
    status = _status(note)
    state, at = _queue_state(note)
    if state == "set-aside" and at == "integration" and _pr(note):
        note.set("status", "review")
        note.set("ready", _stamp(now))
        note.remove("integrating")
        return "integration", f"blocked->review (set aside at Integration; ready: {_stamp(now)})"
    if state == "set-aside" and at == "run" and status in HAND_BACK_RUN_STATUSES:
        note.set("status", "in_progress")
        note.remove("owner")
        note.set(HANDED_BACK_KEY, _stamp(now))  # the restart's mark-started records start=hand-back
        return "run", f"{status}->in_progress (set aside at its run; owner: cleared)"
    return None, ("set aside at Integration with no pr:" if at == "integration"
                  else f"status is {status or 'none'!r} (queue state {state}{'' if at is None else ' at ' + at})")


def cmd_hand_back(args) -> int:
    """A set-aside task re-enters at the stage it stopped (ADR 0030 decision 4): set aside at Integration
    -> review (ready: restamped, it rejoins the Integration queue); set aside at its run (a blocked,
    review-blocked or plan-blocked note, or a code-writing review note approved without a pr:) ->
    in_progress (owner: removed, the next `next --running` restarts it, and its own call re-runs on the
    existing tree and branch). Everything else is refused, nothing written. A task an undecided RACE or
    UNVERIFIED holds (_race_holds, on the rollout its `rollout:` names) is refused before anything is
    written, as `carry` refuses: exit 2, one ERROR line per held task naming it and `/thread:repair`, and
    no listed task written. Handing it back would let it integrate and later `resume` with no `RACE decided:`
    line. The explicit re-entry (repair after Lachy answers, "retry [[task]]", the lead after a descope) starts a
    fresh automatic-retry stretch (p16-4, ADR 0033): it removes `auto_retries_used` and `quota_retries_used` and
    re-stamps `auto_retry_sha` with the block it re-enters (_block_fingerprint, read before the transition; removed
    when that block has none), so an identical re-block goes straight back to a human. Every hand-back that moves a
    note spends its live answers in the same save (_spend_answers, ADR 0035), so no bare hand-back leaves one behind
    to re-arm the lead's *Recorded answer* on an identical re-block; a refused hand-back spends nothing.
    `--answer <stamp>` (one slug only, else usage exit 2) is a compare-and-swap: the note must still be set aside with
    `answerRecorded` at exactly that stamp and form `hand-back`, else exit 1 and nothing written, so the lead and
    repair never both hand back on one answer, and never hand back a new block on an old one."""
    now = _now(args)
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    if args.answer is not None and ("," in args.tasks or not args.tasks.strip()):
        print("ERROR: hand-back: usage: --answer takes one task slug", file=sys.stderr)
        return 2
    notes = list(_each_note(args))
    rollouts, held, decided = {}, [], {}
    for slug, path, note in notes:
        ro = _wikilink_slug(note.get("rollout"))
        if not ro:
            continue  # in no rollout: no Race log or decision to read
        if ro.lower() not in rollouts:
            ro_path = tasks_dir / f"{ro}.md"
            try:
                rollouts[ro.lower()] = Note(ro_path) if ro_path.is_file() else None
            except ValueError:
                rollouts[ro.lower()] = None
        mark = _race_marks(rollouts[ro.lower()], [(path, note)]).get(path.stem.lower())
        if mark and not mark[2]:
            held.append(_race_hold_line("hand-back", slug, mark[1], ro))
        elif mark:
            decided[slug] = mark[1]  # a decision lifted its hold: the move below records it (_record_decision)
    if held:
        for line in held + args._errors:
            print(f"ERROR: {line}", file=sys.stderr)
        return 2
    for slug, _path, note in notes:
        if args.answer is not None:
            got = _answer_recorded(note) if _queue_state(note)[0] == "set-aside" else None
            if not got or got["stamp"] != args.answer or got["form"] != "hand-back":
                args._errors.append(f"hand-back: {slug}: the answer of {args.answer} is spent, superseded, not a hand-back "
                                    "answer or no longer this block's; nothing written")
                for e in args._errors:
                    print(f"ERROR: {e}", file=sys.stderr)
                return 1
        fingerprint = _block_fingerprint(note)  # before the transition: it reads the status's own section
        # handed-back's via (p21-2), read before the transition too: a standing descope_armed: (mark-started clears it)
        # is a descope's re-entry; a fresh `(block -)` answer is one hand-back never spends.
        descoped, dash = _scalar(note.get(DESCOPE_ARMED_KEY)), _fresh_dash_answer(note)
        arm, said = _hand_back_note(note, now)
        if arm is None:
            args._errors.append(f"{slug}: {said} — refusing to hand back: only a blocked note set aside at Integration "
                                "(with a pr:), or a blocked, review-blocked, plan-blocked or PR-less code-writing review "
                                "note set aside at its run, re-enters (a gate-pending note goes through approve-gates)")
            continue
        note.remove(AUTO_RETRIES_USED_KEY)
        note.remove(QUOTA_RETRIES_USED_KEY)
        if fingerprint:
            note.set(AUTO_RETRY_SHA_KEY, fingerprint)
        else:
            note.remove(AUTO_RETRY_SHA_KEY)
        spent = _spend_answers(note, now)
        note.save(dry_run=args.dry_run)
        rollout = _note_rollout(note)
        if slug in decided:
            _record_decision(rollout, slug, decided[slug], "hand-back", args)
        via = "descope" if descoped else "answer" if (args.answer is not None or spent or dash) else "retry"
        _event(rollout, "handed-back", slug, {"via": via, "arm": arm}, args)
        if arm == "integration":
            _event(rollout, "ready", slug, {"pr": _pr(note)}, args)
        print(f"{slug}: {said}{_flag(args, note)}")
    return _finish(args, now)


def cmd_log_integration(args) -> int:
    """Append the lead's clean-path Integration line (`integrated path=lead`) to a `review` note with a
    `pr:`, through _integration_log_line; nothing else on the note changes."""
    now = _now(args)
    bad = [f"--{k} {v!r} is not a 40-hex commit sha" for k, v in
           (("anchor", args.anchor), ("head", args.head), ("base", args.base)) if not SHA40_RE.fullmatch(v or "")]
    if not ISO_STAMP_RE.fullmatch((args.started or "").strip()):
        bad.append(f"--started {args.started!r} is not an ISO stamp (lead-integrate.py stamp prints one)")
    if bad:
        for e in bad:
            print(f"ERROR: log-integration: {e}", file=sys.stderr)
        return 1
    started = args.started.strip()
    for slug, _path, note in _each_note(args):
        if _status(note) != "review" or not _pr(note):
            args._errors.append(f"{slug}: status is {_status(note) or 'none'!r}{'' if _pr(note) else ' with no pr:'}, "
                                "not 'review' with a PR — refusing to log an Integration")
            continue
        row = {"prUrl": _pr(note), "integration": {
            "outcome": "integrated", "path": "lead", "anchor": {"headSha": args.anchor}, "headSha": args.head,
            "baseSha": args.base, "triggers": [],
            "metrics": {"startedAt": started,
                        "waitMinutes": _whole_minutes(_scalar(note.get("ready")), started),
                        "durationMinutes": _whole_minutes(started, now.astimezone().isoformat(timespec="seconds"))},
        }}
        line = _integration_log_line(row)
        # A re-run of the same Integration (same --started, same record) is a no-op even at a later --now:
        # every token but the measured duration must match. append_line's own dedupe covers the rest.
        key = line.split(" ")[:8]
        logged = [l.split(" ") for l in _log_lines(note)]
        if not any(t[:8] == key for t in logged):
            note.append_line(INTEGRATION_LOG_SECTION, line)
        note.save(dry_run=args.dry_run)
        print(f"{slug}: integration log += {line}{_flag(args, note)}")
    return _finish(args, now)


# ---- resume (p6-8) ------------------------------------------------------------------

def _gh(gh_bin, argv, cwd):
    """(stdout, error) for one gh call; error is None on success."""
    try:
        p = subprocess.run([gh_bin, *argv], cwd=cwd, capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.SubprocessError) as e:
        return "", f"{gh_bin}: {e}"
    if p.returncode != 0:
        return "", (p.stderr.strip() or p.stdout.strip() or f"exit {p.returncode}").splitlines()[-1]
    return p.stdout, None


def _project_root(rollout_note):
    m = PROJECT_ROOT_RE.search(rollout_note._body)
    return Path(os.path.expanduser(m.group(1).strip())) if m else None


def cmd_resume(args) -> int:
    """Mark done every linked task whose PR MERGED into the repo's default branch but whose note was
    never marked (an in_progress, review or set-aside note). Checks state AND base: a PR merged into a
    stacked or other branch is not landed. A task an undecided RACE or UNVERIFIED holds (_race_holds) is
    skipped before any gh call, with one stderr `HOLD:` line naming it and `/thread:repair`: main holds a
    combination nobody verified, and only Lachy's `RACE decided:` line releases it. Exit 3 when any task
    was held (ahead of exit 1 for an error; ERROR lines still print), else 1 on an error, else 0."""
    rollout_path = Path(os.path.expanduser(args.rollout))
    if not rollout_path.exists():
        print(f"ERROR: rollout note not found at {rollout_path}", file=sys.stderr)
        return 1
    now = _now(args)
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    rollout_note = Note(rollout_path)
    root = _project_root(rollout_note)
    linked = _linked_task_notes(rollout_path, tasks_dir)
    marks = _race_marks(rollout_note, linked)
    race = {k: (s, kind) for k, (s, kind, decided) in marks.items() if not decided}  # _race_holds, read once
    defaults, errors, held = {}, [], []
    for path, note in linked:
        slug, status, pr = path.stem, _status(note), _pr(note)
        if status in FINISHED_STATUSES or not pr:
            continue
        if slug.lower() in race:
            held.append(f"HOLD: [[{slug}]] {race[slug.lower()][1]} undecided: no \"repair: [[{slug}]] RACE decided:\" "
                        f"line on {rollout_path.stem}; /thread:repair [[{rollout_path.stem}]]")
            continue
        url, num = PR_URL_RE.match(pr), PR_NUM_RE.match(pr)
        if url:
            ref, repo, cwd = pr, url.group(1), None
        elif num:
            if root is None or not root.is_dir():
                errors.append(f"{slug}: pr: {pr!r} is a bare number and the rollout's Project root "
                              f"({root or 'none'}) is not a directory — cannot resolve its repo")
                continue
            ref, repo, cwd = num.group(1), None, str(root)
        else:
            errors.append(f"{slug}: pr: {pr!r} is neither a GitHub PR URL nor a PR number")
            continue
        raw, err = _gh(args.gh_bin, ["pr", "view", ref, "--json", "state,mergedAt,baseRefName,url"], cwd)
        if err is None:
            try:
                info = json.loads(raw)
            except ValueError:
                err = "gh pr view printed no JSON"
        if err is not None:
            errors.append(f"{slug}: gh pr view {ref} failed: {err}")
            continue
        state = str(info.get("state") or "").upper()
        if state != "MERGED":
            print(f"{slug}: PR {ref} is {state or 'in an unknown state'} [no-change]")
            continue
        key = repo or cwd
        if key not in defaults:
            out, derr = _gh(args.gh_bin, ["repo", "view", *([repo] if repo else []), "--json", "defaultBranchRef",
                                          "--jq", ".defaultBranchRef.name"], cwd)
            defaults[key] = (out.strip() or None, derr or ("empty answer" if not out.strip() else None))
        default, derr = defaults[key]
        if default is None:
            errors.append(f"{slug}: cannot resolve the default branch of {repo or cwd}: {derr}")
            continue
        base = str(info.get("baseRefName") or "")
        if base != default:
            print(f"{slug}: PR {ref} merged into {base!r}, not the default branch {default!r} [no-change]")
            continue
        lane_held, lane_fields = _holds_lane(note), _lane_fields_from_log(note)  # read before the flip
        note.set("status", "done")
        if not _scalar(note.get("merged")):
            merged_at = _parse_ts(info.get("mergedAt"))
            if merged_at is not None:
                note.set("merged", _stamp(merged_at))
        note.remove("integrating")
        note.save(dry_run=args.dry_run)
        mark = marks.get(slug.lower())
        if mark is not None:  # a decided RACE or UNVERIFIED (an undecided one was held above): Lachy's decision landed it
            _record_decision(_note_rollout(note), slug, mark[1], "resume", args)
        _landed_events(_note_rollout(note), slug, lane_held, lane_fields, pr, args, running=status == "in_progress")
        print(f"{slug}: status={status or 'none'}->done (PR {ref} merged into {default})" + _flag(args, note))
    print(_progress_for(rollout_path, tasks_dir, now))
    for line in held:
        print(line, file=sys.stderr)
    for e in errors:
        print(f"ERROR: {e}", file=sys.stderr)
    return 3 if held else 1 if errors else 0


# ---- status -----------------------------------------------------------------

def _blocker_summary(note) -> str:
    """The latest run of the section matching the note's own status, then the fixed order. A section
    with no runs is read whole."""
    own = SECTION_BY_STATUS.get(_status(note))
    order = ([own] if own else []) + [h for h in SECTION_BY_STATUS.values() if h != own]
    for heading in order:
        text = note.latest_run_text(heading)
        if text:
            return text
    return ""


def cmd_status(args) -> int:
    rollout_path = Path(os.path.expanduser(args.rollout))
    if not rollout_path.exists():
        print(f"ERROR: rollout note not found at {rollout_path}", file=sys.stderr)
        return 1
    now = _now(args)
    rollout_note = Note(rollout_path)
    ceiling, ceiling_err, ceiling_cause = _ceiling_detail(rollout_note)  # null when invalid or unresolvable: status still reports
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    rows, index = _rows(rollout_path, rollout_note, tasks_dir)
    counts = _counts(rows)
    timeline = _timeline(rows, counts, ceiling, now)
    # The operator's ladder (one local file read, no network): each task's `rung:` stamp, and its drift when a
    # readable ladder lacks it. Drift is scoped to the unlanded rows (CARRIED_STATES): a merged, folded or other
    # row keeps the rung it reached as a record, and an edit to the ladder since is no drift. A refused ladder
    # gives no drift anywhere; its `error` is the flag.
    ladder = _ladder()

    def rung_drift(r):
        stamp = _scalar(r["note"].get("rung"))
        if not stamp or ladder["error"] or r["state"] not in CARRIED_STATES or stamp in ladder["rungs"]:
            return ""
        return stamp

    def task_row(r):
        row = {
            "slug": r["slug"],
            "status": r["status"],
            "queueState": r["state"],
            "setAsideAt": r["setAsideAt"],
            "pr": r["pr"],
            "priority": r["priority"],
            "solo": r["solo"],
            "started": r["started"],
            "merged": r["merged"],
            "integrating": r["integrating"],
            "waitingOn": _unsatisfied(r, index) if r["state"] == "queued" else [],
            "blockerSummary": _blocker_summary(r["note"]),
            "rung": _scalar(r["note"].get("rung")) or None,
            "rungDrift": rung_drift(r),
        }
        # p16-3: the open question, only on a set-aside task whose note holds one (the key is absent otherwise).
        ask = needs_human(r["note"]) if r["state"] == "set-aside" else ""
        if ask:
            row["needsHuman"] = ask
        # p27-4: a task set aside at Integration whose latest run opens a named marker carries which one (`conflict`:
        # an Integration conflict, `red`: a verifier red); the key is absent otherwise, as needsHuman's is.
        block = integration_block(row["blockerSummary"]) \
            if r["state"] == "set-aside" and r["setAsideAt"] == "integration" else None
        if block:
            row["integrationBlock"] = block
        return row

    tasks = [task_row(r) for r in sorted(rows, key=_rank)]
    paused = rollout_note.get("paused")
    out = {
        "rollout": rollout_path.stem,
        "rolloutPath": str(rollout_path),
        "rolloutStatus": rollout_note.get("status"),
        # Pause state (execute §Pausing): `paused` = the stamp's timestamp when the rollout is paused
        # (render as PAUSED, not stalled); `pause_requested` = a soft pause is pending and drains.
        "paused": _scalar(paused) or None,
        "pause_requested": _truthy_flag(rollout_note.get("pause_requested")),
        # What the pause waits for: "sign-off" under await-sign-off's pause (ADR 0034: only gates wait on Lachy, and the
        # repo keeps this as its one unfinished rollout until they are signed or deferred), else null.
        "pausedFor": _scalar(rollout_note.get(PAUSED_FOR_KEY)) or None,
        # Why the rollout must not run as written (`next` refuses it), or null: see "Incomplete".
        "incomplete": incomplete(rollout_path, rollout_note, [(r["path"], r["note"]) for r in rows], index) or None,
        "ceiling": ceiling,
        # Why `ceiling` is null (an invalid `parallel_ceiling`, or an absent one rollout-settings.py could not
        # resolve), else null: status § 3's Ceiling unresolved flag (with ceilingCause). `next` exits 1 on the same error.
        "ceilingError": ceiling_err,
        # What ceilingError needs ("stamp", "file", "root" or "resolver", above _resolved_ceiling), else null.
        "ceilingCause": ceiling_cause,
        "counts": counts,
        "progress": _progress_line(counts, timeline),
        # Per-task started:/merged: stamps — durable on the notes, so elapsed + the rough (~) remaining
        # estimate render with no workflow run alive. null when no task has a started: stamp.
        "timeline": timeline,
        # {source, rungs, error}: the ladder status read (built-in, or the file's path); error non-null when the
        # file is refused, and then rungs is [] (execute halts `ladder file refused` at each call's start).
        "ladder": ladder,
        # The unacked git-env trips (_git_env_hold; execute § 4.5 *Git-env canary*): [] when none. Vault-only, so
        # status § 3's Git-env trip flag holds offline too.
        "gitEnvHold": _git_env_hold(rollout_note),
        "tasks": tasks,
    }
    print(json.dumps(out, indent=2))
    return 0


# ---- touched-phases ---------------------------------------------------------

# The phase number is the vault grammar's PHASE_N, whole or fractional (skills/_shared/vault-grammar.md
# § Phase and task filenames). PHASED_STEM_RE, _phase_key and _phase_sort are its pinned copies here
# (reconcile-project.py keeps its own PHASE_N, phase_key and phase_sort): tests/contracts/vault-grammar.test.mjs
# checks both scripts against the doc's examples.
PHASED_STEM_RE = re.compile(r"^(?P<slug>.+?)-p(?P<n>\d+(?:\.\d+)?)-")


def _phase_key(n: str) -> str:
    """A phase number's canonical form: the whole part numeric (`03` is `3`), the fractional part literal."""
    whole, dot, frac = n.partition(".")
    return str(int(whole)) + dot + frac


def _phase_sort(n: str):
    """Numeric order (`2` before `10`, `3.5` before `5`); `3.5` and `3.50` stay distinct and ordered."""
    return float(n), n


def cmd_touched_phases(args) -> int:
    """Print `--project <slug> --phases <N,...>` per slug among the rollout's linked phased tasks."""
    rollout_path = Path(os.path.expanduser(args.rollout))
    if not rollout_path.exists():
        print(f"ERROR: rollout note not found at {rollout_path}", file=sys.stderr)
        return 1
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    by_slug = {}
    for path, _note in _linked_task_notes(rollout_path, tasks_dir):
        m = PHASED_STEM_RE.match(path.stem)
        if m:  # loose tasks (no `-p<N>-` segment) belong to no phase
            by_slug.setdefault(m.group("slug"), set()).add(_phase_key(m.group("n")))
    for slug in sorted(by_slug):
        print(f"--project {slug} --phases {','.join(sorted(by_slug[slug], key=_phase_sort))}")
    return 0


CITED_STATES = ("queued", "running", "awaiting-integration", "integrating", "set-aside")
CITED_ADR_PATH = re.compile(r"docs/adr/(\d{4})")
CITED_ADR_WORD = re.compile(r"\bADR[ -](\d{4})\b")
CITED_CONTEXT = re.compile(r"(?:^|(?<=[\s`'\"(\[]))((?:[A-Za-z0-9_.-]+/)*CONTEXT\.md)\b")
CITED_HOME = re.compile(r"(?:^|(?<=[\s`'\"(\[]))(~/[^\s`'\"()<>\[\]]+)")
CITED_TRAIL = ".,;:)`'\""


def _cited_home(path: str) -> str:
    """A `~/` path as written, a trailing `:<line>` and trailing punctuation stripped."""
    prev = None
    while prev != path:
        prev = path
        path = path.rstrip(CITED_TRAIL)
        path = re.sub(r":\d+$", "", path)
    return path


def cmd_cited(args) -> int:
    """Print the paths the rollout's not-yet-merged tasks cite (execute § 2.7, ADR 0042)."""
    rollout_path = Path(os.path.expanduser(args.rollout))
    if not rollout_path.is_file():
        print(f"ERROR: rollout note not found at {rollout_path}", file=sys.stderr)
        return 2
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    out = set()
    for _path, note in _linked_task_notes(rollout_path, tasks_dir):
        if _queue_state(note)[0] not in CITED_STATES:
            continue
        for item in note.get_list("touches"):
            item = str(item).strip().strip("\"'")
            if item:
                out.add(item)
        body = note._body
        for m in CITED_ADR_PATH.finditer(body):
            out.add(f"docs/adr/{m.group(1)}-*.md")
        for m in CITED_ADR_WORD.finditer(body):
            out.add(f"docs/adr/{m.group(1)}-*.md")
        for m in CITED_CONTEXT.finditer(body):
            out.add(m.group(1))
        for m in CITED_HOME.finditer(body):
            p = _cited_home(m.group(1))
            if len(p) > 2:
                out.add(p)
    for p in sorted(x for x in out if x.rstrip("/").rsplit("/", 1)[-1] != "THREAD.md"):
        print(p)
    return 0


# ---- fold-journals ----------------------------------------------------------

# run_record.py, shared with every skill: the Run record's one writer and its schema (ADR 0032).
RUN_RECORD_PY = Path(__file__).resolve().parent.parent.parent / "_shared" / "scripts" / "run_record.py"
_RUN_RECORD = None


def _run_record():
    """run_record.py, loaded on first use so no other subcommand pays for it or can fail on it."""
    global _RUN_RECORD
    if _RUN_RECORD is None:
        spec = importlib.util.spec_from_file_location("thread_run_record", RUN_RECORD_PY)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _RUN_RECORD = mod
    return _RUN_RECORD


# A Workflow runId as it names its journal file: no separator, no `..`, so the path stays in journalDir.
RUN_ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]*")
# journal key -> call-journal field, each an int >= 0 or dropped with a WARN
JOURNAL_INTS = (("totalTokens", "tokens"), ("durationMs", "durationMs"), ("agentCount", "agents"),
                ("startTime", "startTime"))


def _record_lines(path):
    """(the record's parsed lines (dicts only), the 1-based numbers of the lines that do not parse)."""
    out, bad = [], []
    with open(path, "rb") as f:
        for n, raw in enumerate(f, 1):
            try:
                d = json.loads(raw)
            except ValueError:
                bad.append(n)
                continue
            if isinstance(d, dict):
                out.append(d)
    return out, bad


def cmd_fold_journals(args) -> int:
    """Fold each bound Workflow call's journal into the rollout's Run record as a call-journal line."""
    rr = _run_record()
    try:
        slug = rr.normalise_slug(args.rollout, "rollout")
    except rr.Refused as e:
        print(f"ERROR: Refused: {e}", file=sys.stderr)
        return 2
    if slug == rr.REVIEWS:  # run_record refuses every emit into it: reserved for review rounds
        print(f"ERROR: Refused: rollout {rr.REVIEWS!r} is reserved for review rounds", file=sys.stderr)
        return 2
    try:
        path = rr.record_path(slug)
    except ValueError as e:
        print(f"ERROR: cannot resolve the events directory: {e}", file=sys.stderr)
        return 1
    if not os.path.exists(path):
        print(f"fold-journals: {slug}: no run record at {path}")
        return 0
    try:
        lines, bad = _record_lines(path)
    except OSError as e:
        print(f"ERROR: cannot read the run record {path}: {e}", file=sys.stderr)
        return 1

    bound = {}  # runId -> the latest run-bound line for it, in first-appearance order
    for d in lines:
        if d.get("kind") == "run-bound" and isinstance(d.get("runId"), str):
            bound[d["runId"]] = d
    terminal, latest = set(), {}
    for d in lines:
        if d.get("kind") == "call-journal" and isinstance(d.get("runId"), str):
            latest[d["runId"]] = d
            if d.get("status") in rr.TERMINAL_STATUSES:
                terminal.add(d["runId"])

    folded = already = unchanged = warnings = 0

    def warn(msg):
        nonlocal warnings
        warnings += 1
        print(f"WARN: {msg}", file=sys.stderr)

    for n in bad:  # a crash can leave a partial line (run_record's docstring): skipped, never fatal
        warn(f"{path}:{n}: the record line does not parse; skipped")

    for run_id, b in bound.items():
        task = b.get("task")
        who = f"{run_id} [[{task}]]"
        if run_id in terminal:
            print(f"already folded {who}")
            already += 1
            continue
        if not RUN_ID_RE.fullmatch(run_id) or ".." in run_id:
            warn(f"{who}: runId is not a journal file name ([A-Za-z0-9][A-Za-z0-9_.-]*, no ..); skipped")
            continue
        jdir = b.get("journalDir")
        jdir = os.path.expanduser(jdir) if isinstance(jdir, str) else ""
        if not jdir or not os.path.isabs(jdir):
            warn(f"{who}: journalDir {b.get('journalDir')!r} is not an absolute path; skipped")
            continue
        jpath = os.path.join(jdir, run_id + ".json")
        if not os.path.exists(jpath):
            warn(f"{who}: no journal at {jpath} (still in flight, or cleaned up)")
            continue
        try:
            with open(jpath, "rb") as f:
                journal = json.load(f)
        except (OSError, ValueError) as e:
            warn(f"{who}: cannot read the journal {jpath}: {e}")
            continue
        if not isinstance(journal, dict):
            warn(f"{who}: the journal {jpath} is not a JSON object; skipped")
            continue
        if journal.get("runId") != run_id:
            warn(f"{who}: the journal {jpath} names runId {journal.get('runId')!r}; skipped")
            continue
        status = journal.get("status")
        if not isinstance(status, str) or not status:
            warn(f"{who}: the journal {jpath} has no status; skipped")
            continue

        jargs = journal.get("args")
        jmode = jargs.get("mode") if isinstance(jargs, dict) else None
        mode = b.get("call") or (jmode if isinstance(jmode, str) and jmode else "task")
        fields = {"runId": run_id, "status": status, "mode": mode}
        for key, field in JOURNAL_INTS:
            if key not in journal:
                continue
            v = journal[key]
            if isinstance(v, int) and not isinstance(v, bool) and v >= 0:
                fields[field] = v
            else:
                warn(f"{who}: {key} {v!r} is not an integer >= 0; dropped from the fold")

        prev = latest.get(run_id)  # the writer's own test (_same_fold): the kind fields and task, ts and host aside
        if prev is not None and prev.get("task") == task and \
                {k: v for k, v in prev.items() if k not in rr.COMMON} == fields:
            print(f"unchanged {run_id}")
            unchanged += 1
            continue
        nums = " ".join(f"{k}={fields[k]}" for k in ("tokens", "durationMs", "agents") if k in fields)
        desc = f"{who} {mode} status={status}" + (f" {nums}" if nums else "")
        if args.dry_run:
            print(f"would fold {desc}")
            folded += 1
            continue
        if rr.emit(slug, "call-journal", task, fields):
            print(f"folded {desc}")
            folded += 1
        else:
            warn(f"{who}: the run record refused or could not write the fold (see run_record above)")

    verb = "would fold" if args.dry_run else "folded"
    print(f"fold-journals: {slug}: {folded} {verb}, {already} already folded, {unchanged} unchanged, "
          f"{warnings} warnings")
    return 0


# ---- the Run record's emits (p15-2; the module docstring's "Run record") -----------------------------------

# hand-back's run-arm marker: the restart's mark-started consumes it and records start=hand-back.
HANDED_BACK_KEY = "handed_back"
START_CHOICES = ("start", "restart", "revise", "resume")
CALL_CHOICES = ("task", "revise", "integrate")
# A bound runId: the Workflow journal's file stem and its `runId` field (fold-journals reads <journalDir>/<runId>.json).
BIND_RUN_ID_RE = re.compile(r"wf_[A-Za-z0-9][A-Za-z0-9_.-]*")
CAP_KEYS = ("max_review_rounds", "max_iterations", "max_plan_rounds")
CALL_FAILED_PREFIX = "workflow call failed:"
# A dead call's error line that reads as a usage or rate limit (quota-stall; only `workflow call failed:` lines
# are scanned, so task text that mentions a quota never matches).
QUOTA_RE = re.compile(r"usage limit|rate[ -]?limit|quota|too many requests|\b429\b", re.I)
TRANSIENT_MARK = "transient infrastructure failure"           # the engine's TRANSIENT_DIAGNOSIS opening
REVISE_MARK = "revise: rejected at integration re-review"     # the engine's REVISE_MARKER opening, lowercased
OWN_RUN_PREFIX = "own run: "                                  # stageDiagnosis's escape (lead-integrate.py)


def _note_rollout(note):
    """The rollout slug a task note's `rollout:` names, or None."""
    return _wikilink_slug(note.get("rollout"))


def _event(rollout, kind, task=None, fields=None, args=None, ts=None):
    """Record one event in the rollout's Run record through run_record.emit, best-effort: it never raises and
    never changes a verb's exit or stdout. Nothing on --dry-run or with no rollout. ts: the verb's --now when
    given (else the writer's clock), unless the caller passes its own."""
    if not rollout or (args is not None and getattr(args, "dry_run", False)):
        return False
    try:
        rr = _run_record()
    except Exception as e:
        try:
            print(f"run_record: warning: cannot load {RUN_RECORD_PY}: {e}", file=sys.stderr)
        except Exception:
            pass
        return False
    if ts is None:
        now = getattr(args, "now", None) if args is not None else None
        ts = now.isoformat() if now is not None else None
    return rr.emit(rollout, kind, task, fields, ts=ts)


def _record_state(rollout):
    """The rollout's Run record replayed by the reader rules (run_record.py's "Reading the record"):
    {slots: {task}, lane: task|None, holds: {(hold, task)}, paused: bool, carried: {task: from}, decided: {task}},
    tasks lowercased as the writer stores them; `carried` keeps each task's `carried` line no later slot-taken
    consumed; `decided` is every task with a `race-decided` line (_record_decision's once-per-task check). No file
    is an empty record; None when it cannot be read (callers then emit without the open-check)."""
    try:
        path = _run_record().record_path(rollout)
    except Exception:
        return None
    st = {"slots": set(), "lane": None, "holds": set(), "paused": False, "carried": {}, "decided": set()}
    try:
        lines, _bad = _record_lines(path)
    except FileNotFoundError:
        return st
    except OSError:
        return None
    for d in lines:
        kind, task = d.get("kind"), d.get("task")
        if kind == "slot-taken":
            st["slots"].add(task)
            st["carried"].pop(task, None)
        elif kind == "slot-freed":
            st["slots"].discard(task)
        elif kind == "lane-taken":
            st["lane"] = task
        elif kind == "lane-freed":
            if st["lane"] == task:
                st["lane"] = None
            st["holds"].discard(("merge", task))
        elif kind == "hold-started":
            st["holds"].add((d.get("hold"), task))
        elif kind == "hold-ended":
            st["holds"].discard((d.get("hold"), task))
        elif kind == "paused":
            st["paused"] = True
        elif kind == "resumed":
            st["paused"] = False
        elif kind == "race-decided":
            st["decided"].add(task)
        elif kind == "carried":
            if d.get("rollout") == d.get("from"):  # the from-file: the task's Slot, lane and holds end here
                st["slots"].discard(task)
                if st["lane"] == task:
                    st["lane"] = None
                st["holds"] = {h for h in st["holds"] if h[1] != task}
            else:
                st["carried"][task] = d.get("from")
    return st


def _log_tokens(line) -> dict:
    """An Integration log line as {startedAt, outcome, <key>: <value>...} (the `key=value` tokens)."""
    toks = (line or "").split(" ")
    out = {"startedAt": toks[0] if toks else "", "outcome": toks[1] if len(toks) > 1 else ""}
    for t in toks[2:]:
        k, sep, v = t.partition("=")
        if sep:
            out[k] = v
    return out


def _holds_lane(note) -> bool:
    """The note holds the Integration lane: `review` with a `pr:` and either `integrating:` (step 3 to step 4), or
    the Integration log's last line `integrated` with a startedAt at or after `ready:` (the window an integrate
    call's reconciled row leaves, since reconcile removes `integrating:`). A hand-back restamps `ready:` after its
    old integrated line, so it reads as not holding; a `-` startedAt (legacy) reads as not holding."""
    if _status(note) != "review" or not _pr(note):
        return False
    if _scalar(note.get("integrating")):
        return True
    t = _current_log_tokens(note)
    return t is not None and t["outcome"] == "integrated"


def _current_log_tokens(note):
    """The Integration log's last line as _log_tokens when it belongs to the note's current Integration: its
    startedAt at or after `ready:` (a hand-back, a ready review row and approve-gates all restamp `ready:`, so
    an older line is an earlier Integration's). None with no log, a `-` startedAt (legacy), or an older line."""
    last = _last_log_line(note)
    if not last:
        return None
    t = _log_tokens(last)
    started = _iso_minutes(t["startedAt"])
    if started is None:
        return None
    ready = _iso_minutes(_scalar(note.get("ready")))
    return t if ready is None or started >= ready else None


def _lane_fields(path, triggers) -> dict:
    out = {"path": path} if isinstance(path, str) and path and path != "-" else {}
    trig = [t for t in triggers if isinstance(t, str) and t]
    out.update(triggers=trig, conflict="conflict" in trig)
    return out


def _lane_fields_from_log(note) -> dict:
    """lane-freed's path, triggers and conflict from the Integration log's last line, only when that line belongs
    to the current Integration (_current_log_tokens); {} otherwise, so the fields are left out. A prepare
    set-aside or a dead integrate call writes no log line, and an earlier Integration's must not stand in."""
    t = _current_log_tokens(note)
    if t is None:
        return {}
    raw = t.get("triggers", "-")
    return _lane_fields(t.get("path"), [] if raw in ("", "-") else raw.split(","))


def _lane_fields_from_row(integ) -> dict:
    trig = integ.get("triggers")
    return _lane_fields(integ.get("path"), trig if isinstance(trig, list) else [])


def _close_holds(rollout, slug, holds, args, state):
    """hold-ended for each of `holds` the record shows open for the task; every one when the record is unreadable
    (state None: the reader rules absorb an end with nothing open)."""
    for hold in holds:
        if state is None or (hold, slug.lower()) in state["holds"]:
            _event(rollout, "hold-ended", slug, {"hold": hold}, args)


def _landed_events(rollout, slug, held, lane_fields, pr, args, running=False):
    """A landing's events (mark-done, resume): slot-freed outcome=completed when the note read `in_progress`
    (`running`: resume found its PR merged, so its Slot ends at the landing), open race and merge holds end, the
    lane frees on the merge when the note held it, then merged."""
    if not rollout or getattr(args, "dry_run", False):
        return
    if running:
        _event(rollout, "slot-freed", slug, {"outcome": "completed"}, args)
    _close_holds(rollout, slug, ("race", "merge"), args, _record_state(rollout))
    if held:
        _event(rollout, "lane-freed", slug, {"release": "merge", **lane_fields}, args)
    _event(rollout, "merged", slug, {"pr": pr} if pr else {}, args)


def _record_decision(rollout, slug, mark, by, args):
    """race-decided {mark, by} (p21-2): `by` (resume, hand-back, auto-retry) moved the task because Lachy's `RACE
    decided:` line lifted its RACE or UNVERIFIED hold. The one writer of the kind, and at most once per task per record
    (_record_state's `decided`); an unreadable record emits anyway, as _close_holds does (the reader counts per task).
    Nothing on --dry-run or with no rollout."""
    if not rollout or getattr(args, "dry_run", False):
        return
    state = _record_state(rollout)
    if state is not None and slug.lower() in state["decided"]:
        return
    _event(rollout, "race-decided", slug, {"mark": mark, "by": by}, args)


def _halt_lane(rollout, slug, args, state):
    """A halt frees the lane: the task's open merge hold ends, then lane-freed release=halt."""
    _close_holds(rollout, slug, ("merge",), args, state)
    _event(rollout, "lane-freed", slug, {"release": "halt"}, args)


_RESOLVED_CAPS = {}


def _resolved_caps(rollout_note) -> dict:
    """The round caps rollout-settings.py resolves for the rollout's Project root (rollouts.toml, then the
    built-in), once per process per root; {} when it cannot (the caps are then left out of the settings)."""
    key = str(_project_root(rollout_note))
    if key not in _RESOLVED_CAPS:
        res = _resolved_settings(rollout_note)["settings"] or {}
        try:
            _RESOLVED_CAPS[key] = {k: res[k]["value"] for k in CAP_KEYS if k in res}
        except Exception:
            _RESOLVED_CAPS[key] = {}
    return _RESOLVED_CAPS[key]


def _pos_int(raw):
    s = _scalar(raw)
    return int(s) if re.fullmatch(r"[0-9]+", s) and int(s) >= 1 else None


def _slot_settings(note, rollout_note):
    """(settings, error) for a slot-taken: the effective values after per-task overrides (§ 3's order)."""
    ceiling, err = _ceiling(rollout_note)
    if err:
        return None, err
    out = {"parallel_ceiling": ceiling}
    for key in CAP_KEYS:
        raw = note.get(key)
        if raw is None:
            raw = rollout_note.get(key)
        if raw is not None:
            value = _pos_int(raw)
        elif key == "max_iterations" and _scope(note) == "read-only":
            value = 1
        else:
            value = _resolved_caps(rollout_note).get(key)
            if not (isinstance(value, int) and not isinstance(value, bool) and value >= 1):
                value = None
        if value is not None:
            out[key] = value
    rung = _scalar(note.get("rung"))
    if is_rung_name(rung):
        out["rung"] = rung
    return out, None


def _start_kind(note, explicit) -> str:
    """slot-taken's start, first match: --start resume; a hand-back, signed-gate or descope marker -> hand-back;
    --start revise|restart|start; `started:` present -> restart; else start. Read before mark-started's writes."""
    if explicit == "resume":
        return "resume"
    if any(_scalar(note.get(k)) for k in (HANDED_BACK_KEY, GATES_SIGNED_KEY, DESCOPE_ARMED_KEY)):
        return "hand-back"
    if explicit:
        return explicit
    return "restart" if _scalar(note.get("started")) else "start"


def _rollout_note_path(args, rollout) -> Path:
    given = getattr(args, "rollout", None)
    if given and Path(os.path.expanduser(given)).stem.lower() == rollout.lower():
        return Path(os.path.expanduser(given))
    return Path(os.path.expanduser(args.tasks_dir)) / f"{rollout}.md"


def _rollout_note_read(args, rollout, cache):
    """(path, Note or None, why, unreadable) for the rollout note a task's `rollout:` names (_rollout_note_path),
    read once per verb run: mark-started's arm decision and its slot-taken share it. unreadable: the note may
    exist but could not be read (the arm decision fails closed on it)."""
    key = rollout.lower()
    if key not in cache:
        path = _rollout_note_path(args, rollout)
        try:
            cache[key] = (path, Note(path), None, False) if _is_kind(path, stat.S_ISREG) else \
                (path, None, f"no rollout note at {path}", False)
        except (OSError, ValueError) as e:
            cache[key] = (path, None, f"cannot read {path}: {e}", True)
    return cache[key]


def _record_slot_taken(args, slug, note, rollout, start, cache):
    """mark-started's slot-taken. With no `rollout:`, no rollout note or no resolvable ceiling, one warning and
    nothing recorded (a Slot with no ceiling cannot be read against it)."""
    def warn(why):
        print(f"run_record: warning: slot-taken for {slug} not recorded: {why}", file=sys.stderr)

    if args.dry_run:
        return
    if not rollout:
        return warn("the note has no rollout:")
    _path, rollout_note, why, _unreadable = _rollout_note_read(args, rollout, cache)
    if rollout_note is None:
        return warn(why)
    settings, err = _slot_settings(note, rollout_note)
    if err:
        return warn(err)
    fields = {"settings": settings, "start": start}
    state = _record_state(rollout)
    carried = state["carried"].get(slug.lower()) if state else None
    if carried:
        fields["carriedFrom"] = carried
    _event(rollout, "slot-taken", slug, fields, args)


def _lead_reason(kind, diag) -> str:
    """The reason a lead-written row (lead-integrate.py set-aside) was given, from its rendered diagnosis."""
    s = (diag or "").strip()
    if kind == "integration":
        return re.sub(r"^integration:\s*", "", s.split("\n", 1)[0], flags=re.I)
    if kind == "revise-stopped":
        for line in s.split("\n"):
            m = re.match(r"\s*revise stopped:\s*(.*)$", line, re.I)
            if m:
                return m.group(1)
        return ""
    return s[len(OWN_RUN_PREFIX):] if s.startswith(OWN_RUN_PREFIX) else s


def _set_aside_stage(note_status, integ, lead, prior, failed, diag, pr) -> str:
    """Where a set-aside task stopped (the module docstring's stage table, first match)."""
    if note_status == GATE_PENDING_STATUS:
        return "gate"
    if integ is not None or lead == "integration" or (lead == "own" and prior == "review"):
        return "integrate"
    if lead == "revise-stopped":
        return "review"
    if lead == "own" and failed:
        return "implement"
    if note_status == "plan-blocked":
        return "plan"
    if note_status == "review-blocked":
        return "review"
    if note_status == "blocked" and diag.strip().lower().startswith(REVISE_MARK):
        return "review"
    if note_status == "review" and not pr:
        return "review"
    return "implement"


def _reason_class(note_status, integ, lead, prior, failed, reason, diag, pr, asked) -> str:
    """Why a task was set aside (the module docstring's reasonClass table, first match). `asked` is the row's own
    needsHuman being a non-empty string (p16-3), never the note's `## Needs you` section: an integrate or lead row
    carries null, so its class is unchanged."""
    first = reason.split("\n", 1)[0].strip().lower()
    if failed and QUOTA_RE.search(first):
        return "quota"
    if failed and (prior == "in_progress" or lead == "integration"):
        return "call-failed"
    if lead and (first.startswith("merge-task") or first.startswith("base moved")
                 or first.startswith("head moved after integration")):
        return "merge-task"
    if lead and first.startswith("merge declined"):
        return "declined"
    if lead == "integration":
        return "prepare"
    if lead == "revise-stopped":
        return "revise-stopped"
    if TRANSIENT_MARK in diag:
        return "transient"
    if note_status == GATE_PENDING_STATUS:
        return "gate"
    # p16-3: a stop on a question is not a plan or review round run out; another round can never answer it, so it
    # must not read as plan-rejected or review-rounds (the Reflection raises a round cap on those). A gate stop wins.
    if asked:
        return "needs-human"
    if note_status == "plan-blocked":
        return "plan-rejected"
    if note_status == "review-blocked":
        return "review-rounds"
    if note_status == "review" and not pr:
        return "approved-without-pr"
    if integ is not None and integ.get("outcome") == "set-aside":
        # p27-4: an Integration conflict and a verifier red at Integration are named by the diagnosis's first line.
        block = integration_block(diag)
        return f"integration-{block}" if block else "integration-set-aside"
    return "blocked"


def _reconcile_events(args, rollout, slug, task, note, prior, held, lane_fields, note_status, pr, ready_stamped):
    """One row's events, against the note's status (`prior`), _holds_lane (`held`) and the Integration log's lane
    fields (`lane_fields`, for a lead row, which carries no `integration`) read before its writes."""
    if args.dry_run or not rollout:
        return
    integ = task.get("integration") if isinstance(task.get("integration"), dict) else None
    outcome = integ.get("outcome") if integ else None
    lead = task.get("leadSetAside") if isinstance(task.get("leadSetAside"), str) else None
    diag = task.get("blockerDiagnosis") if isinstance(task.get("blockerDiagnosis"), str) else ""
    reason = _lead_reason(lead, diag) if lead else ""
    failed = bool(lead) and reason.lower().startswith(CALL_FAILED_PREFIX)
    ask = task.get("needsHuman")
    asked = isinstance(ask, str) and bool(ask.strip())
    state_after, at_after = _queue_state(note)
    if prior == "in_progress" and integ is None:
        if note_status == "review" and pr:
            outcome_s = "ready"
        elif note_status == "done":
            outcome_s = "completed"
        elif failed:
            outcome_s = "lost"
        else:
            outcome_s = "set-aside"
        _event(rollout, "slot-freed", slug, {"outcome": outcome_s}, args)
    if ready_stamped:
        _event(rollout, "ready", slug, {"pr": pr} if pr else {}, args)
    if note_status == "done" and prior != "done":
        _event(rollout, "merged", slug, {"readOnly": True}, args)
    rejected = integ is not None and outcome == "rejected"
    if held and not (integ is not None and outcome == "integrated"):
        fields = {"release": "reject" if rejected else "set-aside"}
        fields.update(_lane_fields_from_row(integ) if integ is not None else lane_fields)
        _close_holds(rollout, slug, ("merge",), args, _record_state(rollout))
        _event(rollout, "lane-freed", slug, fields, args)
    # A rejected row that leaves the note `blocked` is followed by its seeded revise, so it is no set-aside; one
    # that ends review-blocked (its last review round used) is.
    revise_follows = rejected and note_status == "blocked"
    if (prior == "in_progress" or held) and state_after == "set-aside" and not revise_follows:
        stage = _set_aside_stage(note_status, integ, lead, prior, failed, diag, pr)
        _event(rollout, "set-aside", slug, {
            "stage": stage,
            "reasonClass": _reason_class(note_status, integ, lead, prior, failed, reason, diag, pr, asked),
            "setAsideAt": at_after}, args)
        error_line = reason.split("\n", 1)[0].strip()
        if failed and QUOTA_RE.search(error_line):
            _event(rollout, "quota-stall", slug, {"stage": stage, "detail": error_line[:500]}, args)


# review-split.py, beside this module: the original / regression split of one engine review round (p21-3).
REVIEW_SPLIT_PY = Path(__file__).resolve().parent / "review-split.py"
_SPLIT = None
# A judge's head the split may hand to git: 7-40 hex, never an option or a ref name (the engine applies the same rule).
REVIEW_HEAD_RE = re.compile(r"[0-9a-fA-F]{7,40}\Z")


def _review_split():
    """review-split.py, loaded on first use (the _run_record() pattern)."""
    global _SPLIT
    if _SPLIT is None:
        spec = importlib.util.spec_from_file_location("thread_review_split", REVIEW_SPLIT_PY)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _SPLIT = mod
    return _SPLIT


def _rv_warn(slug, why):
    try:
        print(f"run_record: warning: {slug}: reviewVerdicts: {why}", file=sys.stderr)
    except Exception:
        pass


def _verdict_entry(e):
    """A reviewVerdicts entry when well formed (round an int >= 1, verdict approve | changes, head a string,
    feedback a list of strings), else None."""
    if not isinstance(e, dict):
        return None
    rnd, verdict, head, feedback = e.get("round"), e.get("verdict"), e.get("head"), e.get("feedback")
    if isinstance(rnd, bool) or not isinstance(rnd, int) or rnd < 1 or verdict not in ("approve", "changes"):
        return None
    if not isinstance(head, str) or not isinstance(feedback, list) or not all(isinstance(f, str) for f in feedback):
        return None
    return {"round": rnd, "verdict": verdict, "head": head, "feedback": feedback}


def _review_verdict_events(args, rollout, slug, task, prior):
    """p21-3: one review-verdict event per entry of an engine row's reviewVerdicts (each master-review round the call
    judged), written once per run_record.verdict_key: an entry whose key the record already holds for this task (a
    signed-gate or Lost-call resume replaying the stopped call's rounds) is skipped. Its head is resolved to a full
    sha in the task tree first (an abbreviated and a full head key alike); a head that is not 7-40 hex is dropped
    with a warning and never reaches git. A `changes` round is split original / regression by review-split.py
    against the task's first judged head (the record's earlier heads, then this row's); an approve is 0/0/0.
    Only for a row that ends a Slot (the note read in_progress) and carries no `integration` (an Integration
    re-review is no master-review round); nothing on --dry-run, with no rollout, or for a row without the key (a
    pre-p21-3 engine's, a lead-written one). Best-effort: it never changes the verb's exit or stdout."""
    if args.dry_run or not rollout or prior != "in_progress" or task.get("integration") is not None:
        return
    verdicts = task.get("reviewVerdicts")
    if verdicts is None:
        return
    if not isinstance(verdicts, list):
        _rv_warn(slug, f"not a list ({type(verdicts).__name__}); no review-verdict recorded")
        return
    try:
        rr = _run_record()
        me = rr.normalise_slug(slug, "task")
        try:
            lines, _bad = _record_lines(rr.record_path(rollout))
        except Exception:  # no record yet, or unreadable: no history to skip or to take a baseline from
            lines = []
        heads, seen = [], set()
        for d in lines:
            if d.get("kind") != "review-verdict" or d.get("task") != me:
                continue
            if isinstance(d.get("head"), str) and d["head"]:
                heads.append(d["head"])
            seen.add(rr.verdict_key(d))
        sp = _review_split()
        tree = task.get("worktreePath") if isinstance(task.get("worktreePath"), str) else ""
        for i, raw in enumerate(verdicts, 1):
            e = _verdict_entry(raw)
            if e is None:
                _rv_warn(slug, f"entry {i} is malformed (round, verdict, head, feedback); skipped")
                continue
            head = e["head"]
            if head and not REVIEW_HEAD_RE.match(head):
                _rv_warn(slug, f"round {e['round']}: head {head[:60]!r} is not 7-40 hex; recorded without one")
                head = ""
            elif head:
                head = sp.resolve(tree, head.lower())
            digest = rr.verdict_digest(e["verdict"], e["feedback"])
            key = rr.verdict_key({"task": me, "round": e["round"], "head": head, "digest": digest})
            if key in seen:
                continue
            if e["verdict"] == "approve":
                counts = {"findings": 0, "original": 0, "regression": 0}
            else:
                counts = sp.split(tree, sp.baseline(tree, heads, head), head, e["feedback"])
            fields = {"round": e["round"], "verdict": e["verdict"], "findings": counts["findings"],
                      "original": counts["original"], "regression": counts["regression"], "digest": digest}
            if head:
                fields["head"] = head
            _event(rollout, "review-verdict", slug, fields, args)
            seen.add(key)
            if head:
                heads.append(head)
    except Exception as e:
        _rv_warn(slug, f"not recorded: {type(e).__name__}: {e}")


def _idle_reason(git_env, paused, pause_requested, holds, queued, start, race_hold, set_aside, trickle_held) -> str:
    """The idle-slots reason (the module docstring's table, first match). `trickle_held`: this call holds a queued row
    on `trickle:` (a stalled row waits only on the ceiling)."""
    if git_env:
        return "hold-git-env"
    if paused or pause_requested:
        return "pause-drain"
    if trickle_held:
        return "hold-trickle"
    starting = {id(r) for r in start}
    waiting = [r for r in queued if id(r) not in starting]
    waiting_ids = {id(r) for r in waiting}
    held = sorted(((r, why) for r, why in holds if id(r) in waiting_ids), key=lambda h: _rank(h[0]))
    if held:
        why = held[0][1]
        if why.startswith("depends on"):
            return "dependency"
        if why.startswith("solo") or why.startswith("behind solo"):
            return "solo"
    if not waiting:
        if any(h["kind"] == "RACE" for h in race_hold):
            return "hold-race"
        if set_aside:
            return "awaiting-hand-back"
    return "queue-tail"


def _rollout_settings(rollout_note, ceiling) -> dict:
    """idle-slots' settings: the ceiling plus the rollout's own stamped caps (ints >= 1)."""
    out = {"parallel_ceiling": ceiling}
    for key in CAP_KEYS:
        value = _pos_int(rollout_note.get(key)) if rollout_note.get(key) is not None else None
        if value is not None:
            out[key] = value
    return out


def _task_note(args, slug):
    """(path, Note) for --tasks <one slug>, or (path, error)."""
    path = Path(os.path.expanduser(args.tasks_dir)) / f"{slug}.md"
    if not path.is_file():
        return path, f"{slug}: task note not found at {path}"
    try:
        return path, Note(path)
    except (OSError, ValueError) as e:
        return path, str(e)


def _journal_dir(args):
    """(journalDir, error): --journal-dir, else <dir>/<session id>/workflows for the one transcript
    ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/*/${CLAUDE_CODE_SESSION_ID}.jsonl."""
    if args.journal_dir:
        return os.path.normpath(os.path.expanduser(args.journal_dir)), None
    sid = os.environ.get("CLAUDE_CODE_SESSION_ID") or ""
    if not sid or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", sid) or ".." in sid:
        return None, "CLAUDE_CODE_SESSION_ID is not set (pass --journal-dir <abs>)"
    cfg = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude")
    hits = sorted(Path(cfg).glob(f"projects/*/{sid}.jsonl"))
    if len(hits) != 1:
        return None, (f"{len(hits)} transcripts match {cfg}/projects/*/{sid}.jsonl, not one "
                      "(pass --journal-dir <abs>)")
    return str(hits[0].parent / sid / "workflows"), None


def _journal_dir_refusal(jdir: str, run_id: str):
    """Why an explicit --journal-dir cannot hold run_id's journal, or None (p27-3). fold-journals reads
    <jdir>/<runId>.json, which the Workflow tool writes into the session's workflows/ dir only when the call
    ends; at launch it has created the run's transcript dir, <session>/subagents/workflows/<runId>/ (the
    "Transcript dir" it prints). So the dir passes when it holds <runId>.json, or when it is a workflows/ dir
    whose session holds that run subdir. Anything else (that Transcript dir above all) would only warn
    `no journal at` at the fold, once the note has moved on and no rebind is possible."""
    if os.path.isfile(os.path.join(jdir, f"{run_id}.json")):
        return None
    run_sub = os.path.join("subagents", "workflows", run_id)
    if os.path.basename(jdir) == "workflows" and os.path.isdir(os.path.join(os.path.dirname(jdir), run_sub)):
        return None
    # A dir under <session>/subagents/workflows (the Transcript dir, its parent or a file in it) names its session.
    parts = Path(jdir).parts
    at = [i for i in range(1, len(parts) - 1) if parts[i:i + 2] == ("subagents", "workflows")]
    likely = str(Path(*parts[:at[-1]]) / "workflows") if at else "<session>/workflows"
    return (f"--journal-dir {jdir} holds no {run_id}.json and is no workflows/ dir whose session holds "
            f"{run_sub}/ (the Workflow tool's Transcript dir is not the journal dir): pass the session's "
            f"workflows/ dir, {likely}")


def cmd_bind_run(args) -> int:
    """run-bound for the call the lead just launched (the module docstring's bind-run)."""
    def usage(msg):
        print(f"ERROR: bind-run: usage: {msg}", file=sys.stderr)
        return 2

    slug = args.tasks.strip()
    if not slug or "," in slug:
        return usage("--tasks takes one task slug")
    for flag, value in (("--run-id", args.run_id), ("--resumed-from", args.resumed_from)):
        if value is not None and (not BIND_RUN_ID_RE.fullmatch(value) or ".." in value):
            return usage(f"{flag} {value!r} is not a Workflow runId (wf_[A-Za-z0-9][A-Za-z0-9_.-]*, no ..)")
    if args.journal_dir is not None and not os.path.isabs(os.path.expanduser(args.journal_dir)):
        return usage(f"--journal-dir {args.journal_dir!r} is not an absolute path")
    _path, note = _task_note(args, slug)
    if isinstance(note, str):
        print(f"ERROR: bind-run: {note}; nothing written", file=sys.stderr)
        return 1
    rollout = _note_rollout(note)
    if not rollout:
        print(f"ERROR: bind-run: {slug}: the note has no rollout:; nothing written", file=sys.stderr)
        return 1
    if args.call == "integrate":
        if not _holds_lane(note):
            print(f"ERROR: bind-run: {slug}: an integrate call's note must hold the lane (review with a pr: and "
                  f"integrating:, or an integrated last log line); it reads {_status(note) or 'none'!r}; nothing "
                  "written", file=sys.stderr)
            return 1
    elif _status(note) != "in_progress":
        print(f"ERROR: bind-run: {slug}: a {args.call} call's note must read in_progress, not "
              f"{_status(note) or 'none'!r}; nothing written", file=sys.stderr)
        return 1
    jdir, err = _journal_dir(args)
    if not err and args.journal_dir:
        err = _journal_dir_refusal(jdir, args.run_id)
    if err:
        print(f"ERROR: bind-run: {slug}: {err}; nothing written", file=sys.stderr)
        return 1
    fields = {"runId": args.run_id, "journalDir": jdir, "call": args.call}
    if args.resumed_from:
        fields["resumedFrom"] = args.resumed_from
    _event(rollout, "run-bound", slug, fields, args)
    print(f"{slug}: run-bound {args.run_id} call={args.call}"
          + (f" resumedFrom={args.resumed_from}" if args.resumed_from else "") + f" journalDir={jdir}"
          + (" (dry-run)" if args.dry_run else ""))
    return 0


def cmd_free_lane(args) -> int:
    """The lead frees the lane at the lane-free rule or a halt: a merge-hold close, then lane-freed halt."""
    slug = args.tasks.strip()
    _path, note = _task_note(args, slug)
    if isinstance(note, str):
        print(f"ERROR: free-lane: {note}; nothing written", file=sys.stderr)
        return 1
    if not _holds_lane(note):
        print(f"ERROR: free-lane: {slug}: does not hold the lane (status {_status(note) or 'none'!r}, no "
              "integrating: and no integrated last log line since ready:); nothing written", file=sys.stderr)
        return 1
    rollout = _note_rollout(note)
    if rollout and not args.dry_run:
        _halt_lane(rollout, slug, args, _record_state(rollout))
    print(f"{slug}: lane freed (halt)" + (" (dry-run)" if args.dry_run else ""))
    return 0


def cmd_hold(args) -> int:
    """The lead's merge and race holds: hold-started / hold-ended, idempotent against the record."""
    slug = args.tasks.strip()
    path, note = _task_note(args, slug)
    if isinstance(note, str):
        print(f"ERROR: hold: {note}; nothing written", file=sys.stderr)
        return 1
    rollout = _note_rollout(note)
    if args.state == "start":
        if args.hold == "merge" and not _holds_lane(note):
            print(f"ERROR: hold: {slug}: a merge hold needs the task to hold the lane; nothing written", file=sys.stderr)
            return 1
        if args.hold == "race":
            rpath = Path(os.path.expanduser(args.tasks_dir)) / f"{rollout}.md" if rollout else None
            try:
                rnote = Note(rpath) if rpath is not None and rpath.is_file() else None
            except (OSError, ValueError):
                rnote = None
            held = _race_holds(rnote, [(path, note)]).get(path.stem.lower()) if rnote is not None else None
            if not held or held[1] != "RACE":
                print(f"ERROR: hold: {slug}: no undecided RACE: the rollout's {RACE_LOG_SECTION} does not name it "
                      "(or its RACE decided: line stands); nothing written", file=sys.stderr)
                return 1
    state = _record_state(rollout) if rollout and not args.dry_run else None
    is_open = state is not None and (args.hold, slug.lower()) in state["holds"]
    skip = state is not None and (is_open if args.state == "start" else not is_open)
    kind = "hold-started" if args.state == "start" else "hold-ended"
    if not skip:
        _event(rollout, kind, slug, {"hold": args.hold}, args)
    flag = " (dry-run)" if args.dry_run else (" [no-change]" if skip or not rollout else " [written]")
    print(f"{slug}: {kind} {args.hold}{flag}")
    return 0


def cmd_record_pause(args) -> int:
    """A hard pause's record, right after its hand stamp: paused mode=hard, then each Slot and the lane freed."""
    rollout_path = Path(os.path.expanduser(args.rollout))
    if not rollout_path.is_file():
        print(f"ERROR: record-pause: rollout note not found at {rollout_path}", file=sys.stderr)
        return 1
    rollout_note = Note(rollout_path)
    stamp = _scalar(rollout_note.get("paused"))
    if not _valued(stamp):
        print(f"ERROR: record-pause: {rollout_path.stem} carries no paused: stamp (hard-pause step 1 writes it "
              "first); nothing written", file=sys.stderr)
        return 1
    ro = rollout_path.stem
    state = None if args.dry_run else _record_state(ro)
    if state is not None and state["paused"]:
        print(f"{ro}: pause already recorded [no-change]")
        return 0
    at = _parse_ts(stamp)
    _event(ro, "paused", None, {"mode": "hard"}, args, ts=at.isoformat() if at else None)
    freed = []
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    for path, note in sorted(_linked_task_notes(rollout_path, tasks_dir), key=lambda pn: pn[0].stem.lower()):
        if _status(note) == "in_progress":
            _event(ro, "slot-freed", path.stem, {"outcome": "stopped"}, args)
            freed.append(f"slot {path.stem}")
        elif _holds_lane(note):
            if not args.dry_run:
                _halt_lane(ro, path.stem, args, state)
            freed.append(f"lane {path.stem}")
    print(f"{ro}: hard pause recorded ({', '.join(freed) or 'nothing in flight'})"
          + (" (dry-run)" if args.dry_run else ""))
    return 0


# ---- defer ------------------------------------------------------------------

def cmd_defer(args) -> int:
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    slugs = [s.strip() for s in args.tasks.split(",") if s.strip()]
    expected = Path(os.path.expanduser(args.rollout)).stem.lower() if args.rollout else None
    errors = []
    for slug in slugs:
        path = tasks_dir / f"{slug}.md"
        if not path.exists():
            errors.append(f"{slug}: task note not found at {path}")
            continue
        try:
            note = Note(path)
        except ValueError as e:
            errors.append(str(e))
            continue
        if expected is not None:
            cur = (_wikilink_slug(note.get("rollout")) or "").lower()
            if cur and cur != expected:
                errors.append(f"{slug}: belongs to rollout {cur!r}, not {expected!r} — refusing to defer")
                continue
        # Read before anything is cleared: `rollout:` goes, and with it the only way to record the frees.
        rollout, prior, held = _note_rollout(note), _status(note), _holds_lane(note)
        note.set("status", "open")
        for key in ("wave", "rollout", "owner", "started", "merged", "integrating", "ready", GATES_SIGNED_KEY,
                    DESCOPE_ARMED_KEY, HANDED_BACK_KEY, *AUTO_RETRY_KEYS):
            note.remove(key)
        note.save(dry_run=args.dry_run)
        if rollout and not args.dry_run:
            state = _record_state(rollout)
            if prior == "in_progress":
                _event(rollout, "slot-freed", slug, {"outcome": "stopped"}, args)
            if held:
                _halt_lane(rollout, slug, args, state)
            _close_holds(rollout, slug, ("race",), args, state)
        print(f"{slug}: deferred->open (rollout/owner and started/merged/integrating/ready/{GATES_SIGNED_KEY}/"
              f"{DESCOPE_ARMED_KEY}/{HANDED_BACK_KEY}/{'/'.join(AUTO_RETRY_KEYS)} cleared, "
              "a legacy `wave:` included)" +
              (" (dry-run)" if args.dry_run else " [written]"))
    for e in errors:
        print(f"ERROR: {e}", file=sys.stderr)
    return 1 if errors else 0


# ---- descope (p14-4) ----------------------------------------------------------------

DESCOPE_ARMED_KEY = "descope_armed"
SCOPE_AUTO_SECTION = "## Scope decision (automatic)"
REPAIR_INPUT_SECTION = "## Repair input"
DESCOPE_POINTER = "(descoped: see ## Scope decision (automatic))"
DESCOPE_ENTRY = "- descoped (automatic) "     # the entry line status greps (status § 4 **Descoped.**)
DESCOPE_MARK_RE = re.compile(
    r"^<!-- descope run=(\d+) part=([0-9a-f]{12}) mode=(optional|owner)(?: owner=([^\s>]+))? -->\s*$")
# A refused descope's durable record (ADR 0035 decision 2): one line per block, keyed on the top Plan-blocked run's
# number and sha (_plan_block_key), so the refusal holds for that block in every session and a new run is judged afresh.
DESCOPE_REFUSED_SECTION = "## Descope refused (automatic)"
DESCOPE_REFUSED_RE = re.compile(r"^- (\S+) descope refused \(automatic\) run=(\d+) sha=([0-9a-f]{12}), (.*)$")
# Record sections: never part of the brief the plan judge judges against.
BRIEF_EXCLUDE = ("## Plan-blocked feedback", "## Review-blocked feedback", "## Blocker diagnosis",
                 "## Review history", REPAIR_INPUT_SECTION, "## Scope decision", APPROVED_PLAN_SECTION,
                 INTEGRATION_LOG_SECTION, APPROVED_GATES_SECTION, GATE_PENDING_SECTION, NEEDS_HUMAN_SECTION,
                 "## Decisions", "## Resume prompt", "## Descope refused")
MARKER_WORDS = r"(?:consider|considering|optional|optionally|nice to have|nice-to-have)"
OPTIONAL_MARK_RE = re.compile(rf"\b{MARKER_WORDS}\b")
# A marker negated by not / never / no (or an n't) up to two words before it is no marker: "not optional".
NEGATED_RE = re.compile(r"(?:\b(?:not|never|no)|n['’]t)\s+(?:[\w-]+\s+){0,2}$")
# A clause that is only a marker word ended by `:` or `.` ("Nice to have:", "Optional.") marks the next clause.
MARKER_ONLY_RE = re.compile(rf"[*_\s]*{MARKER_WORDS}[*_\s]*[:.][*_\s]*")
# Clauses split at `.`, `;`, `:`, `!` or `?` followed by whitespace, at ` — ` / ` – `, and at the coordinators
# `, and` / `, but` / `, then`, so a marker never reaches past a coordinated second instruction.
CLAUSE_SPLIT_RE = re.compile(r"(?<=[.;:!?])\s+| [—–] |,\s+(?:and|but|then)\s+")
ADR_RE = re.compile(r"\bADR[ -]?\d{1,4}\b|docs/adr/", re.I)
KEBAB_RE = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")
LIST_ITEM_RE = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+")


def _fold(text) -> str:
    """Whitespace collapsed and case-folded: how a part, a quote and the brief are compared."""
    return " ".join(str(text).split()).casefold()


def _find_all(hay: str, needle: str):
    out, i = [], hay.find(needle)
    while needle and i >= 0:
        out.append(i)
        i = hay.find(needle, i + 1)
    return out


def _body_sections(note):
    """(lines, sections): the body's lines and [(heading, [line indices])], the preamble first (heading '')."""
    lines = note._body.split("\n")
    sections = [("", [])]
    for i, line in enumerate(lines):
        if line.startswith("## "):
            sections.append((line.strip(), []))
        else:
            sections[-1][1].append(i)
    return lines, sections


def _is_brief(heading: str) -> bool:
    return heading == "" or not heading.startswith(BRIEF_EXCLUDE)


def _brief_items(note):
    """(lines, items, fenced): the brief is the body minus the record sections (BRIEF_EXCLUDE); an item is a list item
    with its continuation lines, a paragraph, or a heading line, each [heading, first, last, text]. A fenced code
    block is never an item, so no pointer is ever appended inside one (a fence line ends the item before it):
    `fenced` holds each brief fenced block's folded text instead, an unclosed one running to its section's end."""
    lines, sections = _body_sections(note)
    items, fenced = [], []
    for heading, idxs in sections:
        if not _is_brief(heading):
            continue
        cur, fence = None, None
        for i in idxs:
            line = lines[i]
            if fence is not None:
                if FENCE_RE.match(line):
                    fenced.append(_fold(" ".join(fence)))
                    fence = None
                else:
                    fence.append(line)
                continue
            if FENCE_RE.match(line):
                cur, fence = None, []
                continue
            if not line.strip():
                cur = None
                continue
            if cur is None or LIST_ITEM_RE.match(line) or line.lstrip().startswith("#"):
                cur = [heading, i, i, line.strip()]
                items.append(cur)
                if line.lstrip().startswith("#"):
                    cur = None
            else:
                cur[2] = i
                cur[3] += " " + line.strip()
        if fence is not None:
            fenced.append(_fold(" ".join(fence)))
    return lines, items, fenced


def _clauses(text: str):
    """A folded item split into clauses (CLAUSE_SPLIT_RE): at `.`, `;`, `:`, `!` or `?` followed by whitespace, at
    ` — ` / ` – `, and at `, and` / `, but` / `, then`."""
    return CLAUSE_SPLIT_RE.split(text)


def _marks(clause: str):
    """The start of every optional marker word in a clause that no not / never / no (or n't) negates."""
    return [m.start() for m in OPTIONAL_MARK_RE.finditer(clause) if not NEGATED_RE.search(clause[:m.start()])]


def _part_hits(items, part_f):
    """[(item, total, marked, clauses)] for every brief item holding the folded part: how many occurrences, how many
    are marked optional, and the clauses that hold it. An occurrence is marked when an un-negated marker word starts
    at or before it in its own clause, or when the clause before is only a marker word ended by `:` or `.`
    ("Nice to have: a canary", "Optional. A canary"). An occurrence that crosses a clause boundary is never marked."""
    hits = []
    for item in items:
        text = _fold(LIST_ITEM_RE.sub("", item[3], count=1))
        total = len(_find_all(text, part_f))
        if not total:
            continue
        marked, holding, carry = 0, [], False
        for clause in _clauses(text):
            lead, carry = carry, bool(MARKER_ONLY_RE.fullmatch(clause))
            found = _find_all(clause, part_f)
            if not found:
                continue
            holding.append(clause)
            marks = _marks(clause)
            marked += len(found) if lead else sum(1 for pos in found if marks and marks[0] <= pos)
        hits.append((item, total, marked, holding))
    return hits


def _optional_in_brief(hits) -> bool:
    """Optional in the note: the part is in the brief, and every occurrence carries its own in-clause marker."""
    return bool(hits) and all(marked == total for _item, total, marked, _c in hits)


def _recorded_decision(note, needles) -> str:
    """The recorded human decision holding one of the folded needles, as its heading, or '': a `## Decisions…`
    section, a `## Scope decision…` other than the automatic one, a `## Repair input` line without `(automatic)`,
    `## Approved gates` and `## Gated inputs (awaiting sign-off)`."""
    lines, sections = _body_sections(note)
    for heading, idxs in sections:
        if heading.startswith("## Decisions") or heading in (APPROVED_GATES_SECTION, GATE_PENDING_SECTION) or \
                (heading.startswith("## Scope decision") and heading != SCOPE_AUTO_SECTION):
            text = [lines[i] for i in idxs]
        elif heading == REPAIR_INPUT_SECTION:
            text = [lines[i] for i in idxs if "(automatic)" not in lines[i]]
        else:
            continue
        folded = _fold("\n".join(text))
        if any(n and n in folded for n in needles):
            return heading
    return ""


def _upstream(slug: str, index) -> set:
    """Lowercased slugs in a task's transitive `depends-on:` / `blocked-by:` closure, a tombstone's `merged_into:`
    target included."""
    seen, stack = set(), [slug]
    while stack:
        entry = index.get(stack.pop().lower())
        if entry is None:
            continue
        nexts = _dep_entries(entry[1])
        if _status(entry[1]) == "merged" and _wikilink_slug(entry[1].get("merged_into")):
            nexts.append(_wikilink_slug(entry[1].get("merged_into")))
        for dep in nexts:
            if dep.lower() not in seen:
                seen.add(dep.lower())
                stack.append(dep)
    return seen


def _owner_check(slug, owner, quote_f, rollout_path, rollout_note, tasks_dir) -> str:
    """'' when [[owner]] may take the part over, else why not (an ASK): it is not the task itself; it is linked to
    the same rollout, unlanded and active (its queue state carried, so done, merged, dropped and parked are out);
    no undecided RACE or UNVERIFIED holds it; it is not upstream of the task; and its note holds --owner-quote.
    Nothing proves the owner owns the part: that judgement is the caller's."""
    if owner.lower() == slug.lower():
        return "--owner names the task itself"
    linked, index = _scan(rollout_path, tasks_dir)
    entry = index.get(owner.lower())
    if entry is None or (_wikilink_slug(entry[1].get("rollout")) or "").lower() != rollout_path.stem.lower():
        return f"[[{owner}]] is not a task of [[{rollout_path.stem}]]"
    state = _queue_state(entry[1])[0]
    if state not in CARRIED_STATES:
        return f"[[{owner}]] is {_status(entry[1]) or 'no status'} ({state}): it will not land the part"
    if owner.lower() in _race_holds(rollout_note, linked):
        return f"[[{owner}]] is held by an undecided RACE or UNVERIFIED"
    if owner.lower() in _upstream(slug, index):
        return f"[[{owner}]] is upstream of [[{slug}]] (its depends-on / blocked-by closure)"
    if quote_f not in _fold(entry[1]._body):
        return f"--owner-quote is not in [[{owner}]]'s note"
    return ""


def _followup_name(slug: str, short: str) -> str:
    """`<project-slug>-followup-<short>`: the project slug is a phased task's `<slug>` (PHASED_STEM_RE), else the
    loose task's own slug."""
    m = PHASED_STEM_RE.match(slug)
    return f"{m.group('slug') if m else slug}-followup-{short}"


def _fm_block(note, key) -> list:
    """The frontmatter lines of `key:` verbatim: its line, plus the block list under it when the value is empty."""
    for i, line in enumerate(note._fm):
        if re.match(rf"^{re.escape(key)}:", line):
            out = [line]
            if not re.sub(r"\s+#.*$", "", line.split(":", 1)[1]).strip():
                for item in note._fm[i + 1:]:
                    if not re.match(r"^\s+-", item):
                        break
                    out.append(item)
            return out
    return [f"{key}: []"]


def _write_followup(path: Path, note, slug, part, reason, run_n, now, clause):
    """File the follow-up: the vault's new-task shape (execute's completion ceremony), never `rollout:`, `phase:` or
    `owner:` (a loose task, never a phase member), `projects:` copied, `descoped_from:` naming the task."""
    lines = ["---", "tags: [task]", "status: open", "priority: normal", "work_depth: shallow",
             *_fm_block(note, "projects"), "contexts: []", "scheduled:", "due:",
             f"captured: {now.astimezone().date().isoformat()}", f'descoped_from: "[[{slug}]]"', "---", "",
             "## Notes", "",
             f"Descoped from [[{slug}]] by an automatic descope at its Plan-blocked feedback run {run_n}: {reason}", "",
             f"- {part}"]
    if clause:
        lines += ["", f"Its item in [[{slug}]]'s brief: {clause}"]
    path.write_text("\n".join(lines) + "\n")


def _and_list(nums) -> str:
    s = [str(n) for n in nums]
    return s[0] if len(s) == 1 else ", ".join(s[:-1]) + " and " + s[-1]


def _plan_block_key(note):
    """(n, sha): the key a refused descope is recorded under, the top `## Plan-blocked feedback` run's number and its
    `<!-- run n end sha=… -->` sha, or for a legacy run whose end marker is gone _sha12 of the run's text (the same
    fallback _block_fingerprint takes). None when the section holds no run. _record_refusal writes it and
    _descope_refusal compares it, so the two can never disagree."""
    runs = note.run_blocks(BLOCKED_SECTIONS["plan-blocked"])
    if not runs:
        return None
    top = _top_run(runs)
    return top["n"], (top["sha"] or _sha12(top["content"]))


def _descope_refusal(note):
    """(n, text) when a refused descope is recorded for the plan-blocked note's current block (ADR 0035 decision 2), else
    None: a `## Descope refused (automatic)` line carrying _plan_block_key's `run=<n> sha=<sha>`, its text after `- `.
    A non-blank line under the section that does not parse fails closed: the refusal stands, so a hand-edited record
    never lets a refused block slip back to an automatic retry. Only a plan-blocked note has a block to refuse, and
    never one whose `descope_armed:` stands: its block was descoped (the refusal pre-check exits before any descope, so
    an armed block carries no earlier refusal), and that descope's hand-back is its way back (repair § 2's
    **plan-blocked, descopable**), which a refusal must never block."""
    if _status(note) != "plan-blocked" or _scalar(note.get(DESCOPE_ARMED_KEY)):
        return None
    key = _plan_block_key(note)
    if key is None:
        return None
    for line in note.section_text(DESCOPE_REFUSED_SECTION).split("\n"):
        s = line.strip()
        if not s:
            continue
        m = DESCOPE_REFUSED_RE.match(s)
        if m is None:
            return key[0], s
        if int(m.group(2)) == key[0] and m.group(3) == key[1]:
            return key[0], s[2:]
    return None


def _record_refusal(path: Path, slug, part, mode, owner, why, now, dry_run):
    """Record descope's exit 3 durably (ADR 0035 decision 2): one `## Descope refused (automatic)` line keyed on the block,
    written in one task-note save only when no line already carries the key. Re-reads the note, so nothing the verb held
    in memory is written. Returns '' when recorded (or already there), None when the note's `descope_armed:` stands
    (nothing recorded: the block's armed descope is its way back, _descope_refusal), else a one-line warning (the verb
    still exits 3; the lead's session key is the backup)."""
    try:
        note = Note(path)
    except (OSError, ValueError) as e:
        return f"cannot read {path}: {e}"
    if _scalar(note.get(DESCOPE_ARMED_KEY)):
        return None
    key = _plan_block_key(note)
    if key is None:
        return f"{slug}: no Plan-blocked feedback run to key the refusal on"
    n, sha = key
    if any(f" run={n} sha={sha}," in l for l in note.section_text(DESCOPE_REFUSED_SECTION).split("\n")):
        return ""
    note.append_line(DESCOPE_REFUSED_SECTION,
                     f'- {_stamp(now)} descope refused (automatic) run={n} sha={sha}, Plan-blocked feedback run {n}: '
                     f'"{part}" ({mode}{" owner=" + owner if owner else ""}): {why}')
    try:
        note.save(dry_run=dry_run)
    except OSError as e:
        return f"cannot write {path}: {e}"
    return ""


def cmd_descope(args) -> int:
    """Record an automatic descope of a plan-blocked task (p14-4), the one verb the live lead (execute § 4.5 step 1.2)
    and /thread:repair § 3d share. The caller judged that the plan-block feedback centres on a part of the task that
    is optional in the note (--optional) or that a later task in the same rollout owns (--owner); this verb checks
    that judgement mechanically and writes the records. Exit 0: descoped ([written], or [no-change] for a complete
    re-run), and the caller runs `hand-back`. Exit 3: ASK, the refusal recorded on the task note (_record_refusal, ADR
    0035 decision 2; a recorded refusal for the block exits 3 again before the part is judged, writing nothing new), and
    repair asks Lachy; while `descope_armed:` stands nothing is recorded, so the armed descope's re-run and hand-back
    stay open. Exit 1: an ERROR, nothing written (a block with a recorded answer included). Exit 2: usage.
    Exit 1 and exit 2 record nothing."""
    def usage(msg):
        print(f"ERROR: descope: usage: {msg}", file=sys.stderr)
        return 2

    def error(msg, tail="nothing written"):
        print(f"ERROR: descope: {msg}; {tail}", file=sys.stderr)
        return 1

    slug = args.tasks.strip()
    part = " ".join(args.part.split())
    reason = " ".join(args.reason.split())
    mode = "optional" if args.optional else "owner"
    owner = (_wikilink_slug(args.owner) or "") if args.owner else ""
    quote = " ".join((args.owner_quote or "").split())
    if not slug or "," in slug:
        return usage("--tasks takes one task slug")
    if not part or not reason:
        return usage("--part and --reason must not be empty")
    if mode == "optional" and (not args.short or args.owner_quote):
        return usage("--optional takes --short <kebab> and no --owner-quote")
    if mode == "owner" and (not owner or not quote or args.short):
        return usage("--owner takes --owner-quote \"<verbatim quote from the owner's note>\" and no --short")

    now = _now(args)
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    rollout_path = Path(os.path.expanduser(args.rollout))
    path = tasks_dir / f"{slug}.md"
    if not path.is_file():
        return error(f"{slug}: task note not found at {path}")
    if not rollout_path.is_file():
        return error(f"rollout note not found at {rollout_path}")
    try:
        note, rollout_note = Note(path), Note(rollout_path)
    except ValueError as e:
        return error(str(e))
    ro = rollout_path.stem
    if (_wikilink_slug(note.get("rollout")) or "").lower() != ro.lower():
        return error(f"{slug}: its rollout: is {note.get('rollout') or 'none'}, not [[{ro}]]")
    if _status(note) != "plan-blocked" or _queue_state(note) != ("set-aside", "run"):
        return error(f"{slug}: status is {_status(note) or 'none'!r}: only a plan-blocked note set aside at its run "
                     "is descoped")
    runs = note.run_blocks(BLOCKED_SECTIONS["plan-blocked"])
    if not runs:
        return error(f"{slug}: no run under {BLOCKED_SECTIONS['plan-blocked']}")
    run_n = _top_run(runs)["n"]
    fu_name = fu_path = None
    if mode == "optional":
        if not KEBAB_RE.match(args.short):
            return error(f"--short {args.short!r} is not kebab-case ([a-z0-9] words joined by -)")
        fu_name = _followup_name(slug, args.short)
        if PHASED_STEM_RE.match(fu_name) or "-rollout-" in fu_name:
            return error(f"the follow-up name {fu_name} would read as a phase member or a rollout note")
        fu_path = tasks_dir / f"{fu_name}.md"
        if fu_path.exists():
            try:
                theirs = _wikilink_slug(Note(fu_path).get("descoped_from")) or ""
            except ValueError:
                theirs = ""
            if theirs.lower() != slug.lower():
                return error(f"{fu_path} exists and is not this task's follow-up (no descoped_from: \"[[{slug}]]\")")

    def ask(why):
        # ADR 0035 decision 2: the refusal is durable, recorded on the task note before the verb exits 3, so every
        # session reads it (`inputs`' humanFix `decide scope or defer`) and no later descope of the block overrides it.
        # Never while `descope_armed:` stands: the block is already descoped, and that descope's hand-back (repair § 2's
        # **plan-blocked, descopable**: re-run it, exit 0 [no-change], then hand-back) must stay open.
        warn = _record_refusal(path, slug, part, mode, owner, why, now, args.dry_run)
        if warn is None:
            print(f"ASK: [[{slug}]] {why}; not recorded: its armed descope (descope_armed:) stands, so re-run it and "
                  f"hand it back: /thread:repair [[{ro}]]")
            return 3
        if warn:
            print(f"WARN: descope: {slug}: the refusal is not recorded: {warn}", file=sys.stderr)
        print(f"ASK: [[{slug}]] {why}; recorded: /thread:repair [[{ro}]] asks Lachy")
        return 3

    # Before the part is judged: a refusal recorded for this block stands (a later descope never overrides it, an answer
    # included), and a block Lachy answered is his (the lead judged it before repair recorded the answer: a descope now
    # would void that answer with its re-entry stamp).
    refused = _descope_refusal(note)
    if refused is not None:
        print(f"ASK: [[{slug}]] descope refused at Plan-blocked feedback run {refused[0]} ({refused[1]}); "
              f"recorded: /thread:repair [[{ro}]] asks Lachy")
        return 3
    answered = _answer_recorded(note)
    if answered is not None:
        print(f"ERROR: descope: {slug}: answered for this block ({answered['stamp']}); the answer stands", file=sys.stderr)
        return 1

    part_f, quote_f = _fold(part), _fold(quote)
    part_sha = _sha12(part_f)
    marks = [m for m in (DESCOPE_MARK_RE.match(l.strip()) for l in note.section_text(SCOPE_AUTO_SECTION).split("\n")) if m]
    armed = _scalar(note.get(DESCOPE_ARMED_KEY))
    lines, items, fenced = _brief_items(note)
    hits = _part_hits(items, part_f)
    if marks:
        # Once per task: the stamp is the "not restarted since" signal (mark-started consumes it), so a block after a
        # restart asks, even when its feedback is byte-identical and no run was added.
        if not armed:
            return ask(f"plan-blocked again after an automatic descope (run {marks[-1].group(1)}): a second block "
                       "asks Lachy")
        same = [m for m in marks if int(m.group(1)) == run_n and m.group(2) == part_sha and m.group(3) == mode and
                (mode == "optional" or (m.group(4) or "").lower() == owner.lower())]
        if not same:
            return ask(f"already descoped automatically at Plan-blocked feedback run {marks[-1].group(1)}: one "
                       "automatic descope per block, so another part or mode asks Lachy")
    else:
        if ADR_RE.search(part) or any(ADR_RE.search(c) for _i, _t, _m, cl in hits for c in cl):
            return ask("the part touches an ADR decision")
        held = _recorded_decision(note, [part_f, quote_f] if mode == "owner" else [part_f])
        if held:
            return ask(f"a recorded decision ({held}) names the part")
        if any(part_f in block for block in fenced):
            return ask(f'"{part}" sits in a fenced code block in the brief: only prose marks a part optional, and an '
                       "owner never takes it")
        if mode == "optional":
            if not hits:
                return ask(f'"{part}" is not in the brief: only a part the note marks optional descopes as optional')
            if not _optional_in_brief(hits):
                return ask(f'"{part}" is required scope: an occurrence has no optional marker (consider, optional, '
                           "nice to have) in its own clause")
        else:
            # Tied to the block: an owned part is quoted verbatim from the latest feedback run or the brief, so a
            # paraphrase of required scope cannot pass for an emergent part. The match is verbatim only.
            if not hits and part_f not in _fold(_top_run(runs)["content"]):
                return ask(f'"{part}" is in neither the latest Plan-blocked feedback run nor the brief: an owned part '
                           "is quoted verbatim from the block")
            if hits and not _optional_in_brief(hits):
                return ask(f'"{part}" is required scope in the brief: an owner never takes required scope')
            why = _owner_check(slug, owner, quote_f, rollout_path, rollout_note, tasks_dir)
            if why:
                return ask(why)

    # The records, each checked and written on its own so a re-run finishes a partial one: the follow-up first, then
    # the task note (Scope decision, brief pointer, Repair input, the stamp) in one save, then the rollout's Notes line.
    stamp, date = _stamp(now), now.astimezone().date().isoformat()
    target = f"follow-up [[{fu_name}]]" if mode == "optional" else f"owned by [[{owner}]]"
    wrote = False
    if fu_path is not None and not fu_path.exists():
        wrote = True
        if not args.dry_run:
            try:
                _write_followup(fu_path, note, slug, part, reason, run_n, now, hits[0][0][3] if hits else "")
            except OSError as e:
                return error(f"cannot write {fu_path}: {e}", "a re-run finishes the records")
    # the brief pointer: on every item holding the part, else (an emergent part) one line in the first brief section
    if hits:
        for item, *_rest in hits:
            if _fold(DESCOPE_POINTER) not in _fold(item[3]):
                lines[item[2]] = lines[item[2]].rstrip() + " " + DESCOPE_POINTER
    else:
        _lines, sections = _body_sections(note)
        first = next((s for s in sections if s[0] and _is_brief(s[0])), sections[0])
        filled = [i for i in first[1] if lines[i].strip()]
        at = (filled[-1] + 1) if filled else (first[1][0] if first[1] else len(lines))
        lines.insert(at, f'- out of scope (automatic descope, Plan-blocked feedback run {run_n}): "{part}", '
                         f"{'owned by [[' + owner + ']]' if owner else 'filed as [[' + fu_name + ']]'} {DESCOPE_POINTER}")
        if filled and at < len(lines) - 1 and lines[at + 1].strip():
            lines.insert(at + 1, "")
    note._set_body_lines(lines)
    if not marks:
        why = "is optional in the brief" if mode == "optional" else f'is owned by [[{owner}]] ("{quote}")'
        note.append_line(SCOPE_AUTO_SECTION, f'{DESCOPE_ENTRY}{stamp}, Plan-blocked feedback run {run_n}: "{part}" {why}; '
                                             f"{target if mode == 'optional' else 'no follow-up'}. {reason}")
        note.append_line(SCOPE_AUTO_SECTION, f"<!-- descope run={run_n} part={part_sha} mode={mode}"
                                             f"{' owner=' + owner if mode == 'owner' else ''} -->")
    ri = [l for l in note.section_text(REPAIR_INPUT_SECTION).split("\n") if "(automatic)" in l]
    if not any(_fold(f'"{part}"') in _fold(l) for l in ri):
        superseded = sorted({r["n"] for r in runs if r["n"] <= run_n})
        runs_said = (f"runs {_and_list(superseded)} are superseded where they concern" if len(superseded) > 1 else
                     f"run {superseded[0]} is superseded where it concerns")
        note.append_line(REPAIR_INPUT_SECTION,
                         f'- (automatic) {date}: "{part}" is out of this task\'s scope; see {SCOPE_AUTO_SECTION}. '
                         f"Plan-blocked feedback {runs_said} the part; every other point stands.")
    if not armed:
        note.set(DESCOPE_ARMED_KEY, stamp)
    if note.dirty:
        wrote = True
        try:
            note.save(dry_run=args.dry_run)
        except OSError as e:
            return error(f"cannot write {path}: {e}", "a re-run finishes the records")
    link_re = re.compile(rf"descope:\s*\[\[{re.escape(slug)}(?:[|#\\][^\]]*)?\]\].*\brun {run_n}\b", re.I)
    if not any(link_re.search(l) and part_f in _fold(l) for l in rollout_note.section_text(NOTES_SECTION).split("\n")):
        rollout_note.append_line(NOTES_SECTION, f'- {date} descope: [[{slug}]] "{part}" → {target}; Plan-blocked feedback '
                                                f"run {run_n}; {reason}")
        wrote = True
        try:
            rollout_note.save(dry_run=args.dry_run)
        except OSError as e:
            return error(f"cannot write {rollout_path}: {e}", "a re-run finishes the records")
    flag = " (dry-run)" if args.dry_run else (" [written]" if wrote else " [no-change]")
    print(f'{slug}: descoped "{part}" ({mode}) at Plan-blocked feedback run {run_n} → {target}{flag}')
    return 0


# ---- auto-retry (p16-4, ADR 0033) ---------------------------------------------------------------------------

# The task-note markers only verbs write: the agent and infra retries spent in the current stretch, the free quota
# retries, the fingerprint of the block last re-entered (by auto-retry or hand-back) and the last auto-retry's stamp
# (the quota and infra cool-downs' base, and the stamp on its `## Notes` line). hand-back clears the two counters,
# carry clears them too, defer clears all four.
AUTO_RETRIES_USED_KEY = "auto_retries_used"
QUOTA_RETRIES_USED_KEY = "quota_retries_used"
AUTO_RETRY_SHA_KEY = "auto_retry_sha"
AUTO_RETRY_AT_KEY = "auto_retry_at"
AUTO_RETRY_KEYS = (AUTO_RETRIES_USED_KEY, QUOTA_RETRIES_USED_KEY, AUTO_RETRY_SHA_KEY, AUTO_RETRY_AT_KEY)
# A quota block (a dead call whose error line reads as a usage or rate limit) is retried free after a cool-down, from
# the later of its run stamp and the last retry: 30, 60, 120, 240, then 480 minutes (about 15.5 h), then a human.
QUOTA_COOLDOWN_MIN = (30, 60, 120, 240, 480)
# An infra block (the engine's TRANSIENT_DIAGNOSIS, or any other dead call) spends the budget after a short cool-down,
# from the same base: INFRA_COOLDOWN_MIN[auto_retries_used], the last repeating (15, then 60 minutes on the default
# budget of 2). A usage limit that kills an agent mid-run reads as TRANSIENT, never as a quota line, so this back-off
# is all it gets: a longer limit still reaches a human once the budget is spent (ADR 0033 decision 5).
INFRA_COOLDOWN_MIN = (15, 60, 240)
# merge-task.sh's exit-1 texts a code fix on the branch can clear (an allowlist: every other exit-1 text, today's and
# any future wording, is a human's). Each is pinned against merge-task.sh by the auto-retry suite.
MERGE_TASK_FIXABLE = ("has a MERGE CONFLICT with", "a REQUIRED check FAILED on PR")
BRANCH_GONE_MARK = "the PR branch is gone"            # lead-integrate.py prepare's set-aside reason
DECLINED_MARK = "merge declined at the --gated hold"  # execute's --gated decline reason
AUTO_RETRY_MARK = "auto-retry:"                       # the rollout `## Notes` line's verb
AUTO_RETRY_STAGES = ("plan", "implement", "verify", "review", "integrate")  # set-aside's stages minus `gate`
# (frontmatter key, the budget's JSON key, the least valid value): what _retry_budget resolves.
RETRY_BUDGET_KEYS = (("auto_retries", "autoRetries", 0), ("max_review_rounds", "maxReviewRounds", 1))
LEAD_INTEGRATE_PY = Path(__file__).resolve().parent / "lead-integrate.py"
_LEAD = None


def _lead():
    """lead-integrate.py, loaded on first use (the _run_record() pattern): auto-retry's verdict lives there, beside
    `inputs`, so the verb and every `inputs` caller decide with one function."""
    global _LEAD
    if _LEAD is None:
        spec = importlib.util.spec_from_file_location("thread_lead_integrate", LEAD_INTEGRATE_PY)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _LEAD = mod
    return _LEAD


def _block_fingerprint(note):
    """The feedback fingerprint of a set-aside note's latest block: the top run's `<!-- run <n> end sha=… -->` sha in
    its status's section (BLOCKED_SECTIONS), else _sha12 of the section's latest text (legacy text, or a run whose
    marker is gone), else None (no such section, an empty one, or a status with none). Compared with the stored
    `auto_retry_sha`, never with the previous run: reconcile writes no run for identical content. Read it before a
    transition, which changes the status."""
    heading = BLOCKED_SECTIONS.get(_status(note))
    if heading is None:
        return None
    runs = note.run_blocks(heading)
    if runs and _top_run(runs)["sha"]:
        return _top_run(runs)["sha"]
    text = note.latest_run_text(heading)
    return _sha12(text) if text else None


def _block_stamp(note):
    """When the latest block was recorded: its top run's `### Run <n> (<stamp>)` stamp in its status's section, as a
    datetime, or None (no run, a legacy section, an unparseable stamp)."""
    heading = BLOCKED_SECTIONS.get(_status(note))
    found = note._section_bounds(heading) if heading else None
    runs = note.run_blocks(heading) if found else []
    if not runs:
        return None
    m = RUN_HEAD_RE.match(found[0][_top_run(runs)["head"]])
    return _parse_ts(m.group(2)) if m else None


def _note_reason(note):
    """(kind, reason) of a set-aside note's latest block: _lead_reason with the kind read off the note, so an engine
    row and a lead-written one read alike. The text is _blocker_summary's (its own status's section first): one
    starting `integration:` -> integration; a revise marker carrying a `revise stopped:` line -> revise-stopped;
    anything else -> own (its `own run: ` escape dropped)."""
    text = _blocker_summary(note)
    low = text.strip().lower()
    if low.startswith(INTEGRATION_PREFIX):
        kind = "integration"
    elif low.startswith(REVISE_MARK) and any(re.match(r"\s*revise stopped:", l, re.I) for l in text.split("\n")):
        kind = "revise-stopped"
    else:
        kind = "own"
    return kind, _lead_reason(kind, text)


def _retry_class(note) -> str:
    """How an automatic retry treats a block: `quota` (a dead call, `workflow call failed:`, whose error line reads as
    a usage or rate limit: QUOTA_RE), `infra` (the engine's TRANSIENT_DIAGNOSIS, or any other dead call) or `agent`
    (everything else: an agent can act on its feedback)."""
    _kind, reason = _note_reason(note)
    first = reason.split("\n", 1)[0].strip()
    if first.lower().startswith(CALL_FAILED_PREFIX):
        return "quota" if QUOTA_RE.search(first) else "infra"
    return "infra" if TRANSIENT_MARK in _blocker_summary(note) else "agent"


def _stamp_value(raw, minimum):
    """A budget or counter stamp as an int, or None when it is not a bare YAML integer >= minimum: digits only once an
    inline ` # comment` is dropped (_scalar's strip), so a quoted, signed, fractional, boolean or empty value is no
    value."""
    s = re.sub(r"\s+#.*$", "", str(raw)).strip()
    return int(s) if re.fullmatch(r"[0-9]+", s) and int(s) >= minimum else None


def _retry_budget(note, rollout_note) -> dict:
    """The automatic-retry budget: {autoRetries, maxReviewRounds, error, unresolved}. Each key resolves task note ->
    rollout note -> rollouts.toml (_resolved_settings, run once, only for a key absent at both levels) -> built-in, as
    {value, source} with source `task`, `rollout`, `file:repo`, `file:defaults` or `built-in` (None when it cannot).
    `error` names the first invalid stamp (`<key> on [[<note>]] must be an integer >= <min>, got '<raw>'`: execute
    § 3's write-nothing halt); `unresolved` is the resolver's words when it could not run (a refused rollouts.toml,
    a Project root that is gone): no retry, and no halt."""
    out = {"autoRetries": None, "maxReviewRounds": None, "error": None, "unresolved": None}
    res = None
    for key, name, minimum in RETRY_BUDGET_KEYS:
        for where, n in (("task", note), ("rollout", rollout_note)):
            raw = n.get(key) if n is not None else None
            if raw is None:
                continue
            value = _stamp_value(raw, minimum)
            if value is None:
                out["error"] = out["error"] or f"{key} on [[{n.path.stem}]] must be an integer >= {minimum}, got {raw!r}"
            else:
                out[name] = {"value": value, "source": where}
            break
        else:
            if res is None:
                res = _resolved_settings(rollout_note)
            settings = res["settings"] or {}
            entry = settings.get(key)
            if isinstance(entry, dict) and isinstance(entry.get("value"), int) and not isinstance(entry["value"], bool):
                out[name] = {"value": entry["value"], "source": entry.get("source")}
            else:
                out["unresolved"] = out["unresolved"] or (res["error"] or f"rollout-settings.py resolves no {key}")
    return out


def _retry_stage(rollout, slug, note) -> str:
    """The stage an automatic retry re-enters (the `auto-retry` event's `stage`): the task's latest `set-aside` line in
    the Run record (exact pairing for a Reflection), else the module docstring's stage table over arguments rebuilt from
    the note (_note_reason's kind as the lead kind; failed: a `workflow call failed:` reason; prior `review` for a
    `merge-task` reason; an integrate row when the note is review-blocked and its current Integration log line reads
    `rejected`)."""
    try:
        lines, _bad = _record_lines(_run_record().record_path(rollout))
    except Exception:
        lines = []
    for d in reversed(lines):
        if d.get("kind") == "set-aside" and d.get("task") == slug.lower():
            if d.get("stage") in AUTO_RETRY_STAGES:
                return d["stage"]
            break
    kind, reason = _note_reason(note)
    status = _status(note)
    current = _current_log_tokens(note) if status == "review-blocked" else None
    integ = {"outcome": "rejected"} if current is not None and current["outcome"] == "rejected" else None
    stage = _set_aside_stage(status, integ, kind, "review" if kind == "own" and reason.lower().startswith("merge-task")
                             else None, reason.lower().startswith(CALL_FAILED_PREFIX), _blocker_summary(note), _pr(note))
    return stage if stage in AUTO_RETRY_STAGES else "implement"


def _unfinished_retry_line(last, line, note) -> bool:
    """Whether `last`, the slug's last `auto-retry:` line in the rollout's `## Notes`, is this very retry's, written by
    an earlier run of the verb whose task-note save never landed: it equals `line` but for its stamp, and that stamp
    is later than the note's `auto_retry_at` (or the note has none). Each retry's line is stamped with the
    `auto_retry_at` its task-note save writes, and hand-back keeps that stamp, so a completed retry's line is never
    later than it: a genuine later retry that reads the same but for its stamp (a hand-back reset the counters in
    between) is a new line. A line whose stamp does not parse is not one this verb wrote. Minute precision: a save
    that failed in the same minute as the last completed retry reads as finished, and its re-run writes the line
    again."""
    if not last:
        return False
    lp, np_ = last.split(" ", 2), line.split(" ", 2)
    if len(lp) < 3 or lp[2] != np_[2]:
        return False
    stamped = _parse_ts(lp[1])
    if stamped is None:
        return False
    done = _parse_ts(note.get(AUTO_RETRY_AT_KEY)) if note.get(AUTO_RETRY_AT_KEY) is not None else None
    return done is None or stamped > done


def cmd_auto_retry(args) -> int:
    """Execute's automatic retry of one set-aside task (p16-4, ADR 0033; execute § 4.5 step 1.2's *Automatic retry*).
    The verb re-runs lead-integrate.py's auto_retry_verdict before it writes anything, so the lead's `inputs` read
    only routes; --auto-retries and --fingerprint are assertions copied from that read (a mismatch means the note
    changed since). Writes, in order, each a re-run can finish: the rollout `## Notes` line, then the task note in one
    save (hand-back's transition, the counter, `auto_retry_sha`, `auto_retry_at`, the raise), then the events."""
    def error(msg, code=1, tail="nothing written"):
        print(f"ERROR: auto-retry: {msg}; {tail}", file=sys.stderr)
        return code

    slug = args.tasks.strip()
    if not slug or "," in slug:
        return error("usage: --tasks takes one task slug", 2)
    if args.fingerprint is not None and not re.fullmatch(r"[0-9a-f]{12}", args.fingerprint):
        return error(f"usage: --fingerprint {args.fingerprint!r} is not a 12-hex run sha", 2)
    if args.auto_retries is not None and args.auto_retries < 0:
        return error(f"usage: --auto-retries {args.auto_retries} is not an integer >= 0", 2)
    now = _now(args)
    rollout_path = Path(os.path.expanduser(args.rollout))
    path, note = _task_note(args, slug)
    if isinstance(note, str):
        return error(note)
    if not rollout_path.is_file():
        return error(f"rollout note not found at {rollout_path}")
    try:
        rollout_note = Note(rollout_path)
    except (OSError, ValueError) as e:
        return error(str(e))
    ro = rollout_path.stem
    if (_note_rollout(note) or "").lower() != ro.lower():
        return error(f"{slug}: its rollout: is {note.get('rollout') or 'none'}, not [[{ro}]]")
    mark = _race_marks(rollout_note, [(path, note)]).get(path.stem.lower())
    if mark and not mark[2]:
        print(f"ERROR: {_race_hold_line('auto-retry', slug, mark[1], ro)}", file=sys.stderr)
        return 2
    lead = _lead()
    # The rollout's Project root is the lead's `inputs --repo <repoPath>`: the note's pr: is read as a PR URL
    # (`prUrlError`, p17-1) against the same origin, so the verdict re-run here is the one `inputs` printed.
    root = _project_root(rollout_note)
    inp = lead.task_inputs(path, note, repo=str(root) if root is not None else None)
    verdict = lead.auto_retry_verdict(path, note, inp, rollout_note, now)
    if verdict["autoRetryError"]:
        return error(f"{slug}: invalid round budget: {verdict['autoRetryError']}")
    budget = verdict["autoRetryBudget"]
    if args.auto_retries is not None and budget is not None and budget["autoRetries"]["value"] != args.auto_retries:
        return error(f"{slug}: --auto-retries {args.auto_retries} is not the resolved auto_retries "
                     f"{budget['autoRetries']['value']} ({budget['autoRetries']['source']}): the note changed since `inputs`")
    if args.fingerprint is not None and verdict["fingerprint"] and args.fingerprint != verdict["fingerprint"]:
        return error(f"{slug}: --fingerprint {args.fingerprint} is not the block's {verdict['fingerprint']}: the note "
                     "changed since `inputs`")
    if not verdict["autoRetry"]:
        return error(f"{slug}: not auto-retryable: {verdict['autoRetryWhy']}")

    retry_class, fingerprint, raise_to = verdict["autoRetryClass"], verdict["fingerprint"], verdict["autoRetryRaise"]
    n_budget, used, quota = budget["autoRetries"]["value"], verdict["autoRetriesUsed"], verdict["quotaRetriesUsed"]
    if retry_class == "quota":
        quota += 1
        count = f"quota {quota}/{len(QUOTA_COOLDOWN_MIN)}"
    else:
        used += 1
        count = f"{used}/{n_budget}"
    stage = _retry_stage(_note_rollout(note), slug, note)
    status, (_state, at) = _status(note), _queue_state(note)
    raised = f"; max_review_rounds raised to {raise_to}, one round" if raise_to else ""
    line = f"- {_stamp(now)} {AUTO_RETRY_MARK} [[{slug}]] {count} ({stage}; feedback {fingerprint}){raised}"

    # (a) The rollout's `## Notes` line, first: a failed task save leaves the verdict true, so the next step 1.2
    # finishes the records, and the line an earlier run wrote for this same retry is not written twice.
    link_re = re.compile(rf"{re.escape(AUTO_RETRY_MARK)}\s*\[\[{re.escape(slug)}(?:[|#\\][^\]]*)?\]\]", re.I)
    mine = [l.rstrip() for l in rollout_note.section_text(NOTES_SECTION).split("\n") if link_re.search(l)]
    if not _unfinished_retry_line(mine[-1] if mine else None, line, note):
        rollout_note.append_line(NOTES_SECTION, line)
        try:
            rollout_note.save(dry_run=args.dry_run)
        except OSError as e:
            return error(f"{slug}: cannot write {rollout_path}: {e}")
    # (b) The task note in one save: hand-back's own transition, the markers, the raise.
    arm, said = _hand_back_note(note, now)
    if arm is None:  # the verdict read it set aside at its run or at Integration with a pr:
        return error(f"{slug}: {said}", tail="the rollout's Notes line is written: a re-run finishes the records")
    if retry_class == "quota":
        note.set(QUOTA_RETRIES_USED_KEY, quota)
    else:
        note.set(AUTO_RETRIES_USED_KEY, used)
    note.set(AUTO_RETRY_SHA_KEY, fingerprint)
    note.set(AUTO_RETRY_AT_KEY, _stamp(now))
    if raise_to:
        note.set("max_review_rounds", raise_to)
    try:
        note.save(dry_run=args.dry_run)
    except OSError as e:
        return error(f"{slug}: cannot write {path}: {e}", tail="the rollout's Notes line is written: a re-run finishes "
                     "the records")
    # (c) the decision that lifted a RACE or UNVERIFIED hold (once per task), hand-back's own events, then the retry's.
    rollout = _note_rollout(note)
    if mark:
        _record_decision(rollout, slug, mark[1], "auto-retry", args)
    if arm == "integration":
        _event(rollout, "ready", slug, {"pr": _pr(note)}, args)
    fields = {"stage": stage, "setAsideAt": at, "retryClass": retry_class, "used": used, "budget": n_budget,
              "fingerprint": fingerprint}
    if raise_to:
        fields["reviewRounds"] = raise_to
    if retry_class == "quota":
        fields["quotaRetries"] = quota
    _event(rollout, "auto-retry", slug, fields, args)
    flag = " (dry-run)" if args.dry_run else " [written]"
    print(f"{slug}: auto-retry {count} ({stage}; feedback {fingerprint}"
          f"{f'; max_review_rounds raised to {raise_to}' if raise_to else ''}) {status}->{_status(note)}{flag}")
    return 0


# ---- recorded answers (ADR 0035 decision 3) ------------------------------------------------------------------------
#
# Lachy's answer to a set-aside block lives in the task note's `## Repair input`, one entry per answer:
#   - <stamp> <needs you|decision> (block <fingerprint>[; awaiting repair|; left]): "<the ask>" → <the answer>
# A live key is `(block <fp>)` (a `hand-back` answer: a bare hand-back is all that is left, so the lead hands it back),
# `(block <fp>; awaiting repair)` (repair still has work to do first) or `(block <fp>; left)` (answered: left set aside).
# A dead key is `(block <fp>; handed back <stamp>)` (spent by a hand-back), `(block <fp>; superseded <stamp>)` (a later
# answer for the block replaced it) or `(block -)` (a block with no fingerprint: a gate, a PR-less review). Only
# record-answer writes an entry or supersedes one, and only hand-back spends one; nothing else, and no prose, does.

ANSWER_ENTRY_RE = re.compile(r"^- (\S+) (needs you|decision) \(block ([0-9a-f]{12})(?:; (awaiting repair|left))?\): ")
# Any entry, live or dead, with its key's fingerprint (or `-`): the stamps record-answer bumps past.
ANY_ENTRY_RE = re.compile(r"^- (\S+) (?:needs you|decision) \(block ([0-9a-f]{12}|-)(?:;[^)]*)?\): ")
LIVE_KEY_RE = re.compile(r"\(block ([0-9a-f]{12})(?:; (?:awaiting repair|left))?\)")
FORM_KEYS = {"hand-back": "", "awaiting-repair": "; awaiting repair", "left": "; left"}
FORM_NAMES = {None: "hand-back", "awaiting repair": "awaiting repair", "left": "left"}
RAISE_FIELDS = ("max_review_rounds", "max_plan_rounds", "max_iterations")
RUN_HEAD_ANY_RE = re.compile(r"^### Run \d+ \(([^)]*)\)\s*$")


def _last_re_entry(note):
    """(stamp, bad): the latest time the task was re-entered, as far as the note can say: every `### Run <n> (<stamp>)`
    heading in any section (a block recorded), `auto_retry_at:` (an automatic retry), every `- descoped (automatic)
    <stamp>,` entry (an automatic descope, written before the lead's hand-back) and `started:` (a task deferred and
    re-scheduled starts afresh). None when the note has none; `bad` is True when one of them does not parse (an answer
    then fails closed: it never reads as recorded)."""
    stamps, bad = [], False
    for line in note._body.split("\n"):
        m = RUN_HEAD_ANY_RE.match(line)
        raw = m.group(1) if m else (line[len(DESCOPE_ENTRY):].split(",", 1)[0] if line.startswith(DESCOPE_ENTRY) else None)
        if raw is not None:
            ts = _parse_ts(raw)
            bad = bad or ts is None
            if ts is not None:
                stamps.append(ts)
    for key in (AUTO_RETRY_AT_KEY, "started"):
        if _valued(note.get(key)):
            ts = _parse_ts(note.get(key))
            bad = bad or ts is None
            if ts is not None:
                stamps.append(ts)
    return (max(stamps) if stamps else None), bad


def _answer_recorded(note):
    """`inputs`' answerRecorded, the one read execute, status and repair share (ADR 0035 decision 3): the live answer to
    the note's current block, {stamp, kind, form: hand-back | awaiting repair | left, line}, or None. An entry counts
    when its key is live and carries _block_fingerprint(note), and its stamp is strictly later than _last_re_entry: a
    block re-entered since the answer is a fresh ask. Fails closed (None) on a tie with the re-entry stamp, an entry or
    re-entry stamp that does not parse, and two live entries sharing the newest stamp; otherwise the latest wins."""
    fp = _block_fingerprint(note)
    if not fp:
        return None
    last, bad = _last_re_entry(note)
    if bad:
        return None
    live = []
    for line in note.section_text(REPAIR_INPUT_SECTION).split("\n"):
        line = line.strip()
        m = ANSWER_ENTRY_RE.match(line)
        if not m or m.group(3) != fp:
            continue
        ts = _parse_ts(m.group(1))
        if ts is None:
            return None
        if last is None or ts > last:
            live.append((ts, m, line))
    if not live:
        return None
    newest = max(ts for ts, _m, _l in live)
    top = [(m, line) for ts, m, line in live if ts == newest]
    if len(top) != 1:
        return None
    m, line = top[0]
    return {"stamp": m.group(1), "kind": m.group(2), "form": FORM_NAMES[m.group(4)], "line": line}


def _rewrite_keys(note, pick, to):
    """Rewrite the key of each `## Repair input` entry `pick(fingerprint)` selects among the live ones to
    `(block <fp>; <to>)`, in memory (the caller saves). Returns how many changed."""
    found = note._section_bounds(REPAIR_INPUT_SECTION)
    if found is None:
        return 0
    lines, start, end = found
    n = 0
    for i in range(start + 1, end):
        m = ANSWER_ENTRY_RE.match(lines[i].strip())
        if m and pick(m.group(3)):
            lines[i] = LIVE_KEY_RE.sub(lambda k: f"(block {k.group(1)}; {to})", lines[i], count=1)
            n += 1
    if n:
        note._set_body_lines(lines)
    return n


def _spend_answers(note, now) -> int:
    """hand-back's spend: every live answer key on the note becomes `(block <fp>; handed back <now>)`, so an identical
    re-block (which writes no run, so no re-entry stamp) never re-arms the lead's *Recorded answer* and is asked
    afresh (ADR 0033 decision 6)."""
    return _rewrite_keys(note, lambda _fp: True, f"handed back {_stamp(now)}")


def _fresh_dash_answer(note) -> bool:
    """True when `## Repair input` holds a `(block -)` entry (an answer to a block with no fingerprint: a PR-less review,
    a gate) stamped after _last_re_entry: an answer to the block hand-back now re-enters, which it never spends.
    handed-back's via=answer reads it (p21-2)."""
    last, _bad = _last_re_entry(note)
    for line in note.section_text(REPAIR_INPUT_SECTION).split("\n"):
        m = ANY_ENTRY_RE.match(line.strip())
        if m and m.group(2) == "-":
            ts = _parse_ts(m.group(1))
            if ts is not None and (last is None or ts > last):
                return True
    return False


def _spent_count(note, fp) -> int:
    """How many answers for block `fp` a hand-back spent: the `ask <k+1>` in humanFix's label, so an identical re-block
    after a spent answer is a new Needs-you item, pushed again (ADR 0035 decision 3)."""
    if not fp:
        return 0
    needle = f"(block {fp}; handed back "
    return sum(1 for l in note.section_text(REPAIR_INPUT_SECTION).split("\n")
               if ANY_ENTRY_RE.match(l.strip()) and needle in l)


def _resolved_cap(note, rollout_note, key):
    """(value, why): a round budget as a call resolves it (execute § 3; _slot_settings' order): the task's stamp, then the
    rollout's, then rollout-settings.py for the Project root. (None, why) when a stamp is not an integer >= 1 or the
    resolver cannot say."""
    for n in (note, rollout_note):
        raw = n.get(key)
        if raw is not None:
            value = _pos_int(raw)
            return (value, "") if value is not None else \
                (None, f"{key} on [[{n.path.stem}]] must be an integer >= 1, got {raw!r}")
    res = _resolved_settings(rollout_note)
    entry = (res["settings"] or {}).get(key)
    if isinstance(entry, dict) and isinstance(entry.get("value"), int) and not isinstance(entry["value"], bool) and \
            entry["value"] >= 1:
        return entry["value"], ""
    return None, res["error"] or f"rollout-settings.py resolves no {key}"


def cmd_record_answer(args) -> int:
    """Record Lachy's answer to a set-aside block (ADR 0035 decision 3; repair § 3b and § 4): the only writer of a
    `## Repair input` answer entry. See the module docstring's `record-answer`."""
    def error(msg, code=1, tail="nothing written"):
        print(f"ERROR: record-answer: {msg}; {tail}", file=sys.stderr)
        return code

    slug = args.tasks.strip()
    if not slug or "," in slug:
        return error("usage: --tasks takes one task slug", 2)
    fp_arg = args.fingerprint
    if fp_arg != "-" and not re.fullmatch(r"[0-9a-f]{12}", fp_arg):
        return error(f"usage: --fingerprint {fp_arg!r} is neither a 12-hex run sha nor -", 2)
    ask, answer = " ".join(args.ask.split()), " ".join(args.answer.split())
    if not ask or not answer:
        return error("usage: --ask and --answer must not be empty", 2)
    kind = "needs you" if args.kind == "needs-you" else "decision"
    if fp_arg == "-" and args.form:
        return error("--form goes with a fingerprint: a block with none (a gate, a PR-less review) is recorded (block -)")
    if fp_arg != "-" and not args.form:
        return error("--form hand-back|awaiting-repair|left is required with a fingerprint")
    if args.form == "left" and (args.raise_field or args.pr):
        return error("--raise and --pr never go with --form left: a block left set aside changes nothing")
    now = _now(args)
    rollout_path = Path(os.path.expanduser(args.rollout))
    path, note = _task_note(args, slug)
    if isinstance(note, str):
        return error(note)
    if not rollout_path.is_file():
        return error(f"rollout note not found at {rollout_path}")
    try:
        rollout_note = Note(rollout_path)
    except (OSError, ValueError) as e:
        return error(str(e))
    ro = rollout_path.stem
    if (_note_rollout(note) or "").lower() != ro.lower():
        return error(f"{slug}: its rollout: is {note.get('rollout') or 'none'}, not [[{ro}]]")
    state, at = _queue_state(note)
    if state != "set-aside" or at not in ("run", "integration", "gate"):
        return error(f"{slug}: not set aside at its run, at Integration or at a gate ({state})")
    fp = _block_fingerprint(note) or "-"
    if fp_arg != fp:
        return error(f"{slug}: --fingerprint {fp_arg} is not the block's {fp}: re-read `inputs`")
    key = FORM_KEYS[args.form] if args.form else ""
    body = f'{kind} (block {fp}{key}): "{ask}" → {answer}'
    last, bad = _last_re_entry(note)
    if bad:
        return error(f"{slug}: a re-entry stamp on the note (a run heading, auto_retry_at:, a descope entry or started:) "
                     "does not parse, so no answer could ever read as recorded: fix the stamp")
    field = args.raise_field
    question = needs_human(note)
    # A note holding a `## Needs you` question takes its answer as `--kind needs-you`, which removes the section in the
    # same save: a decision recorded beside the open question would let a `hand-back` answer pass hand-back's
    # compare-and-swap with the stale question still in place (repair's Don't).
    if kind == "decision" and question:
        return error(f"{slug}: the note holds a ## Needs you question: record its answer with --kind needs-you")

    # Idempotent: the same live answer, with its raise and pr: already in place, is [no-change] at its existing stamp.
    def live_same():
        for line in note.section_text(REPAIR_INPUT_SECTION).split("\n"):
            m = ANY_ENTRY_RE.match(line.strip())
            if not m or m.group(2) != fp or line.strip().split(" ", 2)[2] != body:
                continue
            ts = _parse_ts(m.group(1))
            if ts is not None and (last is None or ts > last) and (fp == "-" or
                                                                   (_answer_recorded(note) or {}).get("stamp") == m.group(1)):
                return m.group(1)
        return None

    same = live_same()
    if same is not None and (not args.pr or _pr(note) == args.pr) and (not field or (
            note.get(field) is not None and any(re.search(rf"\[\[{re.escape(slug)}\]\] {field} raised to "
                                                          rf"{re.escape(_scalar(note.get(field)))}\b", l)
                                                for l in rollout_note.section_text(NOTES_SECTION).split("\n")))):
        print(f"{slug}: answer recorded ({args.form or '-'}) {same} [no-change]")
        return 0

    if kind == "needs you" and " ".join(question.split()) != ask:
        return error(f"{slug}: --ask is not the note's ## Needs you question" if question else
                     f"{slug}: the note holds no ## Needs you question (record a decision instead)")
    lead = _lead()
    root = _project_root(rollout_note)
    repo = str(root) if root is not None else None
    inp = lead.task_inputs(path, note, repo=repo)
    budget = _retry_budget(note, rollout_note)
    k = budget["maxReviewRounds"]["value"] if budget["maxReviewRounds"] else None
    revise_spent = inp["resumeAt"] == "revise" and k is not None and k <= inp["lastRound"]
    raise_to = None
    if field:
        cf = lead.cause_fix(path, note, inp, rollout_note, now)
        allowed = ({cf["raise"]} if cf and cf.get("raise") else set()) | ({"max_review_rounds"} if revise_spent else set())
        if field not in allowed:
            return error(f"{slug}: --raise {field} is not this block's raise (allowed: "
                         f"{', '.join(sorted(allowed)) or 'none'}): its humanFix names "
                         f"{(cf or {}).get('act') or 'no human fix'}")
        if field == "max_review_rounds" and revise_spent:
            raise_to = inp["lastRound"] + 1
        else:
            value, why = _resolved_cap(note, rollout_note, field)
            if value is None:
                return error(f"{slug}: make no raise: {why}")
            raise_to = value + 1
    if args.pr and not lead.ENGINE_PR_URL_RE.fullmatch(args.pr):
        return error(f"{slug}: --pr {args.pr!r} is not a PR URL (…/pull/<n>)")
    if args.form == "hand-back":
        pr_after = args.pr or _pr(note)
        if at == "integration" and not pr_after:
            return error(f"{slug}: set aside at Integration with no pr: a bare hand-back refuses it: restore it first "
                         "(--pr), or record --form awaiting-repair")
        _url, url_error = lead._note_pr_url(pr_after or None, note, repo)
        if url_error and (at == "integration" or inp["resumeAt"] == "revise"):
            return error(f"{slug}: the pr: gives no PR URL the engine takes ({url_error}): pass --pr, or record --form "
                         "awaiting-repair")
        if inp["resumeAt"] == "revise":
            if k is None:
                return error(f"{slug}: max_review_rounds does not resolve "
                             f"({budget['error'] or budget['unresolved']}): no revise re-entry can be judged")
            if revise_spent and raise_to is None:
                return error(f"{slug}: a revise re-entry with no round left (max_review_rounds {k} <= lastRound "
                             f"{inp['lastRound']}): pass --raise max_review_rounds, or record --form awaiting-repair")

    # The stamp: now's minute, bumped past the last re-entry and every entry for this block, so no two entries of a block
    # share a stamp and none ties a re-entry. A bump more than a minute ahead refuses (re-run in a minute).
    floor = [last] if last is not None else []
    for line in note.section_text(REPAIR_INPUT_SECTION).split("\n"):
        m = ANY_ENTRY_RE.match(line.strip())
        if m and m.group(2) == fp:
            ts = _parse_ts(m.group(1))
            if ts is not None:
                floor.append(ts)
    base = now.astimezone().replace(second=0, microsecond=0)
    at_ts = base
    if floor and max(floor) >= base:
        at_ts = (max(floor) + timedelta(minutes=1)).astimezone().replace(second=0, microsecond=0)
    if at_ts - base > timedelta(minutes=1):
        return error(f"{slug}: the entry's stamp would be {_stamp(at_ts)}, more than a minute after now (the block's last "
                     "re-entry or answer is that recent): re-run in a minute")
    stamp = _stamp(at_ts)

    # (a) The raise's rollout `## Notes` line, in its own save first: a failed task save leaves it for the re-run.
    if raise_to is not None:
        line = (f"- {now.astimezone().date().isoformat()} repair: [[{slug}]] {field} raised to {raise_to}, "
                f"{'one iteration' if field == 'max_iterations' else 'one round'}")
        if line not in [l.rstrip() for l in rollout_note.section_text(NOTES_SECTION).split("\n")]:
            rollout_note.append_line(NOTES_SECTION, line)
            try:
                rollout_note.save(dry_run=args.dry_run)
            except OSError as e:
                return error(f"{slug}: cannot write {rollout_path}: {e}")
    # (b) The task note in one save, the entry last: the `## Needs you` removal, the raise, pr:, the supersede rewrites,
    # then the entry (the lead's trigger for a `hand-back` answer).
    if kind == "needs you":
        note.remove_section(NEEDS_HUMAN_SECTION)
    if raise_to is not None:
        note.set(field, raise_to)
    if args.pr:
        note.set("pr", args.pr)
    if fp != "-":
        _rewrite_keys(note, lambda f: f == fp, f"superseded {stamp}")
    note.append_line(REPAIR_INPUT_SECTION, f"- {stamp} {body}")
    try:
        note.save(dry_run=args.dry_run)
    except OSError as e:
        return error(f"{slug}: cannot write {path}: {e}",
                     tail="nothing written to the task note" + (": a re-run finishes the records" if raise_to else ""))
    fields = {"answerKind": args.kind}  # (p21-2) Lachy's Recorded answer: an act the Hands-off rate counts
    if args.form:
        fields["form"] = args.form
    if field:
        fields["raise"] = field
    fields["pr"] = bool(args.pr)
    _event(_note_rollout(note), "answer-recorded", slug, fields, args)
    flag = " (dry-run)" if args.dry_run else " [written]"
    print(f"{slug}: answer recorded ({args.form or '-'}) {stamp}{flag}")
    return 0


# ---- carry (a supersede, ADR 0030) -------------------------------------------

# _queue_state's exact strings: what a supersede carries into the new rollout, and what stays behind.
CARRIED_STATES = {"queued", "running", "awaiting-integration", "integrating", "set-aside"}
CLOSED_ROLLOUT_STATUSES = {"done", "dropped"}

# Legacy stamps a supersede's carry maps to a rung (ADR 0029 consequences): the old model, effort and cap keys,
# in the order a `restamp` line's drop= lists them. The only line in the skills that spells the cap key's name.
LEGACY_KEYS = ("model", "effort", "tier_capped")
LEGACY_MODELS = ("", "fable", "opus")                          # recognised model values (trimmed, any case)
LEGACY_EFFORTS = ("", "low", "medium", "high", "xhigh", "max")  # recognised effort values; the cap key: any


def _tags(note):
    return {_scalar(t).lower() for t in note.get_list("tags")}


def _link_slug(note, key) -> str:
    """The lowercased note name a wikilink-valued key points at ('' when absent); an inline `# comment`
    is dropped first, as the template's commented `supersedes:` line may carry one."""
    return (_wikilink_slug(_scalar(note.get(key))) or "").lower()


def _carry_note(path: Path, role: str):
    """(Note, None) for an existing, parseable rollout note, else (None, why)."""
    if not path.is_file():
        return None, f"{role} {path}: no such note"
    try:
        note = Note(path)
    except ValueError as e:
        return None, f"{role} {path}: {e}"
    if "rollout" not in _tags(note):
        return None, f"{role} {path.stem}: not a rollout note (its tags lack `rollout`)"
    return note, None


def _legacy_plan(note, rollout_model) -> dict:
    """What a supersede's carry does to one carried note's legacy stamps: {rung, drop, warn}. rung is 'top'
    (it gets the ladder's top rung), 'kept' (its own non-empty `rung:` stays, drifted or not) or '-' (none
    written, and it has none); drop the recognised keys present, in LEGACY_KEYS order; warn one (key, value)
    per unrecognised value, left in place. The top-rung test is the engine's startRung predicate: the note's
    model (failing that, the rollout's) is `fable`, or its effort is `xhigh` or `max`, trimmed, any case."""
    model_key, effort_key, _cap_key = LEGACY_KEYS
    known = {model_key: LEGACY_MODELS, effort_key: LEGACY_EFFORTS}
    drop, warn, vals = [], [], {}
    for key in LEGACY_KEYS:
        value = note.get(key)
        if value is None:
            continue
        vals[key] = _scalar(value).lower()
        if key not in known or vals[key] in known[key]:
            drop.append(key)
        else:
            warn.append((key, _scalar(value)))
    if _scalar(note.get("rung")):
        rung = "kept"
    else:
        model = vals.get(model_key) or rollout_model
        rung = "top" if model == "fable" or vals.get(effort_key) in ("xhigh", "max") else "-"
    return {"rung": rung, "drop": drop, "warn": warn}


def _order_hints(src_note, rows) -> list:
    """carry's `order` lines (p17-2): each clause of the prior rollout's own prose that names two or more carried
    tasks, at least one `queued`, beside an ordering word, as `order <slug>,<slug>[,…]: <clause>`. An order kept only
    in that prose (an older rollout note's lead rules, "p30-2 after p30-1") never reached `depends-on:`, so the carry
    alone would drop it; schedule step 3 reads the clause and proposes the dependency. `rows` are carry's (path, note,
    state, is_carried, plan), the tasks already on an open --from's --to included. Read per line, fenced code skipped,
    a list item's marker stripped; a line splits into clauses at `;` and at sentence ends. A clause names a task by a
    full wikilink to it, its bare slug, or its short id `p<N>-<M>` (the vault grammar's, `<N>` a PHASE_N, so `p3.5-2`
    too; SHORT_ID_RE, which the contract test pins) when exactly one carried slug carries that number, the phase
    matched literally (`p3.5` is never `p3.50` or `p305`); an ambiguous or unmatched one names nothing. Every wikilink
    (any note), bare linked slug and short id is blanked before the ordering words are read, so a word inside a name
    never counts. Direction is left to the reader. Writes nothing; an exact duplicate line prints once."""
    carried = {path.stem.lower(): (path.stem, state) for path, _note, state, is_carried, _plan in rows if is_carried}
    if len(carried) < 2:
        return []
    linked = sorted({path.stem.lower() for path, *_rest in rows}, key=lambda s: (-len(s), s))
    bare_re = re.compile(r"(?<![\w-])(?:" + "|".join(re.escape(s) for s in linked) + r")(?![\w-])", re.I)
    name_re = re.compile(ORDER_MASK_RE.pattern + "|" + SHORT_ID_RE.pattern, re.I)

    def short_id(n, m):
        hits = [s for s in carried if re.search(rf"(?:^|-)p{re.escape(n)}-{m}(?:-|$)", s)]
        return hits[0] if len(hits) == 1 else None

    out, fenced = [], False
    for line in src_note._body.split("\n"):
        if FENCE_RE.match(line):
            fenced = not fenced
            continue
        if fenced:
            continue
        held = []  # placeholder index -> (original text, lowercased slug)

        def mask(m, slug=None):
            held.append((m.group(0), slug if slug is not None else m.group(0).lower()))
            return ORDER_MASK.format(len(held) - 1)

        masked = WIKILINK_FULL_RE.sub(lambda m: mask(m, (_wikilink_slug(m.group(0)) or "").lower()),
                                      LIST_MARK_RE.sub("", line, count=1))
        masked = bare_re.sub(mask, masked)
        for clause in ORDER_CLAUSE_RE.split(masked):
            names = []
            for m in name_re.finditer(clause):
                slug = held[int(m.group(1))][1] if m.group(1) is not None else short_id(m.group(2), m.group(3))
                if slug in carried and slug not in names:
                    names.append(slug)
            if len(names) < 2 or not any(carried[s][1] == "queued" for s in names):
                continue
            if not ORDER_CUE_RE.search(name_re.sub(" ", clause)):
                continue
            text = " ".join(ORDER_MASK_RE.sub(lambda m: held[int(m.group(1))][0], clause).split())
            hint = f"order {','.join(carried[s][0] for s in names)}: {text}"
            if hint not in out:
                out.append(hint)
    return out


def cmd_carry(args) -> int:
    def refuse(msg):
        print(f"ERROR: carry: {msg}", file=sys.stderr)
        return 2

    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    if not tasks_dir.is_dir():
        return refuse(f"tasks dir {tasks_dir} not found")
    src = Path(os.path.expanduser(args.from_))
    src_note, why = _carry_note(src, "--from")
    if why:
        return refuse(why)
    dst = Path(os.path.expanduser(args.to)) if args.to else None
    if dst is None and not args.dry_run:
        return refuse("--to is required (only --dry-run previews without it)")
    src_status = _status(src_note)
    if src_status in CLOSED_ROLLOUT_STATUSES:
        rerun = src_status == "done" and dst is not None and _link_slug(src_note, "superseded_by") == dst.stem.lower()
        if not rerun:
            return refuse(f"--from {src.stem} is {src_status}: a closed rollout carries nothing")
    linked = _scan(src, tasks_dir)[0]
    fresh, why = never_started(src_note, linked)
    if not fresh and not _valued(src_note.get("paused")):
        return refuse(f"--from {src.stem} has run and is not paused ({why}): only a paused or never-started "
                      "rollout is superseded")
    held = _race_holds(src_note, linked)
    if held:
        names = ", ".join(f"[[{slug}]] ({kind})" for slug, kind in sorted(held.values(), key=lambda h: h[0].lower()))
        return refuse(f"--from {src.stem} holds an undecided RACE or UNVERIFIED: {names}: record Lachy's decision "
                      f"first with /thread:repair [[{src.stem}]]")
    git_env = _git_env_hold(src_note)
    if git_env:
        names = ", ".join(dict.fromkeys(f"[[{t['slug']}]]" for t in git_env))
        return refuse(f"--from {src.stem} holds an unacked git-env trip: {names}: record Lachy's ack first with "
                      f"/thread:repair [[{src.stem}]]")
    dst_linked = []
    if dst is not None:
        if dst.stem.lower() == src.stem.lower() or (dst.exists() and dst.resolve() == src.resolve()):
            return refuse(f"--to is --from ({src.stem}): a rollout never carries into itself")
        dst_note, why = _carry_note(dst, "--to")
        if why:
            return refuse(why)
        if dst.parent.resolve() != tasks_dir.resolve():
            return refuse(f"--to {dst} is not directly in the tasks dir {tasks_dir}")
        if _status(dst_note) in CLOSED_ROLLOUT_STATUSES:
            return refuse(f"--to {dst.stem} is {_status(dst_note)}: carry only into an open rollout")
        if _link_slug(dst_note, "supersedes") != src.stem.lower():
            return refuse(f"--to {dst.stem}: its supersedes: does not name {src.stem}")
        dst_linked = _scan(dst, tasks_dir)[0]
        fresh, why = never_started(dst_note, dst_linked)
        if not fresh:
            return refuse(f"--to {dst.stem} has run ({why}): never carry into a running queue")

    # Each carried note's legacy stamps, mapped before any line prints: a refused ladder is a refusal, and the
    # ladder is read only when some carried note needs its top rung (so an unrelated bad file blocks nothing).
    rollout_model = _scalar(src_note.get(LEGACY_KEYS[0])).lower()
    rows = []
    for path, note in sorted(linked, key=lambda pn: (pn[0].stem.lower(), str(pn[0]))):
        state = _queue_state(note)[0]
        carried = state in CARRIED_STATES
        rows.append((path, note, state, carried, _legacy_plan(note, rollout_model) if carried else None))
    top = None
    if any(plan and plan["rung"] == "top" for *_rest, plan in rows):
        ladder = _ladder()
        if ladder["error"]:
            return refuse(f"ladder file refused: {ladder['error']}")
        top = ladder["rungs"][-1]
    for path, _note, _state, _carried, plan in rows:
        for key, value in (plan["warn"] if plan else []):
            print(f"WARN: carry: {path.stem}: {key}: {value} unrecognised, left in place", file=sys.stderr)
    for path, _note, state, carried, plan in rows:
        print(f"{'carry' if carried else 'keep'} {path.stem} {state}")
        if carried and (plan["rung"] == "top" or plan["drop"]):
            rung = top if plan["rung"] == "top" else plan["rung"]
            print(f"restamp {path.stem} rung={rung} drop={','.join(plan['drop']) or '-'}")
    # The order hints read --from's prose against its carried tasks and, while --from is still open, against the
    # tasks already on --to: an interrupted supersede whose own carry ran before it died (§ 0's finish) left none
    # on --from, and this is the only run that reads that prose. A closed re-run's step 7 has confirmed them.
    hint_rows = list(rows)
    if src_status not in CLOSED_ROLLOUT_STATUSES:
        mine = {path.stem.lower() for path, *_rest in rows}
        for path, note in sorted(dst_linked, key=lambda pn: (pn[0].stem.lower(), str(pn[0]))):
            if path.stem.lower() not in mine:
                state = _queue_state(note)[0]
                hint_rows.append((path, note, state, state in CARRIED_STATES, None))
    for hint in _order_hints(src_note, hint_rows):
        print(hint)
    if args.dry_run:
        print("(dry-run)")
        return 0
    written = 0
    for path, note, state, carried, plan in rows:
        if not carried:
            continue
        lane_held = _holds_lane(note)  # before `integrating:` goes
        note.set("rollout", f'"[[{dst.stem}]]"')
        # The automatic-retry counters start afresh in the new rollout; auto_retry_sha stays, so a block identical to
        # the one last re-entered still goes to a human (p16-4, ADR 0033).
        for key in ("owner", "integrating", "wave", AUTO_RETRIES_USED_KEY, QUOTA_RETRIES_USED_KEY):
            note.remove(key)
        if plan["rung"] == "top":
            note.set("rung", top)
        for key in plan["drop"]:
            note.remove(key)
        if not note.dirty:
            continue
        try:
            note.save()
        except OSError as e:
            print(f"ERROR: carry: {path.stem}: cannot write {path}: {e} ({written} note(s) already carried)",
                  file=sys.stderr)
            return 1
        written += 1
        # The from-rollout's record: a carried note's open Slot and lane end there (a paused `next --running ""`
        # can stamp while a stalled in_progress note stands), then `carried` lands in both files.
        if state == "running":
            _event(src.stem, "slot-freed", path.stem, {"outcome": "stopped"}, args)
        if lane_held:
            _halt_lane(src.stem, path.stem, args, _record_state(src.stem))
        _event(dst.stem, "carried", path.stem, {"from": src.stem}, args)
    print(f"[written: {written}]" if written else "[no-change]")
    return 0


# ---- approve-gates ----------------------------------------------------------

def _norm_gate(line: str) -> str:
    """Normalise a gate line for duplicate detection: bullet + sign-off annotation stripped,
    whitespace collapsed, case-folded (mirrors the engine's normalizeGate — a changed cap is
    a DIFFERENT gate)."""
    s = re.sub(r"^[-*]\s+", "", line.strip())
    s = GATE_ANNOT_RE.sub("", s)
    return re.sub(r"\s+", " ", s).strip().lower()


def _last_log_outcome(note):
    """The outcome token of the Integration log's last line (_last_log_line), or None."""
    toks = (_last_log_line(note) or "").split(" ")
    return toks[1] if len(toks) > 1 else None


def _gate_stage(note) -> str:
    """Where a gate-pending note stopped (p12-14): 'integration' when the Integration log's last line is
    `set-aside` and the note has a `pr:` (its integrate call stopped for a gate: the pairing
    `lead-integrate.py inputs` reads as resumeAt: integration), else 'run' (its own call, or a seeded
    revise after a `rejected` line)."""
    return "integration" if _last_log_outcome(note) == "set-aside" and _pr(note) else "run"


def _sign_route(note, slug, now):
    """Flip a gate-pending note whose gates are all signed by the stage it stopped (p12-14), its pending section (and
    any plan judge's bounce beside it, ADR 0038) removed: a stop at Integration -> `review` with `ready:` restamped and
    `integrating:` removed; any other stop -> `in_progress` with a `gates_signed:` marker. The stage is read before the
    flip. Returns (stage, route, ready_pr)."""
    stage = _gate_stage(note)  # before the flip: the pairing reads status gate-pending
    if stage == "run" and _last_log_outcome(note) == "set-aside":
        print(f"WARN: {slug}: the Integration log's last line is set-aside but the note has no pr: — "
              "it cannot rejoin the Integration queue, so it goes to in_progress (its own call)", file=sys.stderr)
    note.remove_section(GATE_PENDING_SECTION)
    note.remove_section(GATE_BOUNCE_SECTION)
    ready_pr = None
    if stage == "integration":
        note.set("status", "review")
        note.set("ready", _stamp(now))
        note.remove("integrating")
        ready_pr = _pr(note)
        route = f"status review (stopped at Integration: rejoins the Integration queue; ready: {_stamp(now)})"
    else:
        note.set("status", "in_progress")
        note.set(GATES_SIGNED_KEY, _stamp(now))
        route = f"status in_progress ({GATES_SIGNED_KEY}: {_stamp(now)}, consumed by the restart's mark-started)"
    return stage, route, ready_pr


def cmd_approve_gates(args) -> int:
    """Record a sign-off for a gate-pending task's declared gated inputs (ADR 0008), and send the task back by the
    stage it stopped (p12-14): a stop at Integration -> `review` with `ready:` restamped and `integrating:` removed
    (it rejoins the Integration queue, and a fresh integrate call re-reads the latest main); any other stop ->
    `in_progress` with a `gates_signed:` marker (Restart routing resumes its gate-pending call on the signed plan,
    execute § 3.7, and the restart's mark-started consumes the marker). The stage is read before the status flips.

    The CALLER's contract: run it bare only after Lachy explicitly signed off the gates, which is the one decision no
    agent may make for him. With --standing it approves only the spend gates his recorded standing approval covers
    (ADR 0034: _approve_standing), and the lead runs that unattended.
    """
    if args.standing:
        return _approve_standing(args)
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    slugs = [s.strip() for s in args.tasks.split(",") if s.strip()]
    date = args.date or datetime.now().astimezone().date().isoformat()
    now = _now(args)
    errors = []
    for slug in slugs:
        path = tasks_dir / f"{slug}.md"
        if not path.exists():
            errors.append(f"{slug}: task note not found at {path}")
            continue
        try:
            note = Note(path)
        except ValueError as e:
            errors.append(str(e))
            continue
        status = note.get("status")
        pending = note.section_text(GATE_PENDING_SECTION)
        if status != GATE_PENDING_STATUS:
            if note.has_heading(APPROVED_GATES_SECTION) and not pending:
                print(f"{slug}: gates already approved [no-change]")
                continue
            errors.append(f"{slug}: status is {status!r}, not {GATE_PENDING_STATUS!r} — refusing to approve gates")
            continue
        gates = [re.sub(r"^[-*]\s+", "", l.strip()) for l in pending.split("\n") if l.strip()]
        if not gates:
            errors.append(f"{slug}: no gates under {GATE_PENDING_SECTION!r} — nothing to sign off")
            continue
        existing = [l for l in note.section_text(APPROVED_GATES_SECTION).split("\n") if l.strip()]
        have = {_norm_gate(l) for l in existing}
        merged = existing + [f"- {g} (approved {date})" for g in gates if _norm_gate(g) not in have]
        note.upsert_section(APPROVED_GATES_SECTION, "\n".join(merged))
        stage, route, ready_pr = _sign_route(note, slug, now)
        note.save(dry_run=args.dry_run)
        _event(_note_rollout(note), "gate-signed", slug, {"standing": False, "gates": len(gates)}, args)  # Lachy's sign-off
        if stage == "integration":
            _event(_note_rollout(note), "ready", slug, {"pr": ready_pr}, args)
        print(f"{slug}: {len(gates)} gate(s) approved (signed off {date}) -> {route}"
              + (" (dry-run)" if args.dry_run else " [written]"))
    for e in errors:
        print(f"ERROR: {e}", file=sys.stderr)
    return 1 if errors else 0


def _standing_limit(note, rollout_note):
    """The standing approval's limit (ADR 0034): ({value, source}, None), or (None, error). `spend_approval_usd`
    resolves task frontmatter -> rollout frontmatter -> rollouts.toml (_resolved_settings, once: file:repo,
    file:defaults) -> the built-in 0, which is off: _retry_budget's order. A stamp that is not a bare integer >= 0 is
    an error, and so is a refused rollouts.toml."""
    for where, n in (("task", note), ("rollout", rollout_note)):
        raw = n.get(SPEND_APPROVAL_KEY)
        if raw is None:
            continue
        value = _stamp_value(raw, 0)
        if value is None:
            return None, f"{SPEND_APPROVAL_KEY} on [[{n.path.stem}]] must be an integer >= 0, got {raw!r}"
        return {"value": value, "source": where}, None
    res = _resolved_settings(rollout_note)
    if res["settings"] is None:
        return None, f"rollout settings refused: {res['error']}"
    entry = res["settings"].get(SPEND_APPROVAL_KEY)
    if not isinstance(entry, dict) or isinstance(entry.get("value"), bool) or not isinstance(entry.get("value"), int):
        return None, f"rollout-settings.py resolves no {SPEND_APPROVAL_KEY}"
    return {"value": entry["value"], "source": entry.get("source") or "built-in"}, None


def _ask_why(verdict, limit, gi):
    """Why a gate stays pending under the standing approval: the exposure reading's own why, else the limit's."""
    if verdict["usd"] is None:
        return verdict["why"]
    if limit["value"] == 0:
        if limit["source"] == "built-in":
            return (f"standing approval off (built-in 0): set [defaults] {SPEND_APPROVAL_KEY} in "
                    "~/.config/thread/rollouts.toml")
        return f"standing approval off ({limit['source']} 0)"
    return (f"total exposure US${gi.format_usd(verdict['usd'])} is over the standing approval's "
            f"US${gi.format_usd(limit['value'])} ({limit['source']})")


def _bounce_why(verdict, gi):
    """Why a gate on a note the plan judge bounced stays pending under the standing approval (ADR 0038), with the
    pricer's own reading of it: its why, or the exposure it would otherwise have signed."""
    reading = verdict["why"] if verdict["usd"] is None else f"exposure US${gi.format_usd(verdict['usd'])}"
    return (f"the plan judge bounced this plan (ADR 0038; its feedback is under {GATE_BOUNCE_SECTION}), so the "
            f"standing approval signs none of its gates; the pricer reads: {reading}")


def _approve_standing(args) -> int:
    """approve-gates --standing (ADR 0034; the module docstring): sign each pending spend gate the standing approval
    covers, leave the rest pending with an ASK line. Exit 0 every gate written, 3 some left, 1 an error."""
    if not args.rollout:
        print("ERROR: --standing needs --rollout", file=sys.stderr)
        return 1
    rollout_path = Path(os.path.expanduser(args.rollout))
    if not rollout_path.is_file():
        print(f"ERROR: rollout note not found at {rollout_path}", file=sys.stderr)
        return 1
    try:
        gi = _gated()
        rollout_note = Note(rollout_path)
    except Exception as e:
        print(f"ERROR: approve-gates --standing: {e}", file=sys.stderr)
        return 1
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    slugs = [s.strip() for s in args.tasks.split(",") if s.strip()]
    date = args.date or datetime.now().astimezone().date().isoformat()
    now = _now(args)
    suffix = " (dry-run)" if args.dry_run else " [written]"
    errors, asked = [], False
    for slug in slugs:
        path = tasks_dir / f"{slug}.md"
        if not path.exists():
            errors.append(f"{slug}: task note not found at {path}")
            continue
        try:
            note = Note(path)
        except ValueError as e:
            errors.append(str(e))
            continue
        if (_note_rollout(note) or "").lower() != rollout_path.stem.lower():
            errors.append(f"{slug}: its rollout: is {note.get('rollout')!r}, not [[{rollout_path.stem}]]; nothing written")
            continue
        status = note.get("status")
        pending = note.section_text(GATE_PENDING_SECTION)
        if status != GATE_PENDING_STATUS:
            if note.has_heading(APPROVED_GATES_SECTION) and not pending:
                print(f"{slug}: gates already approved [no-change]")
                continue
            errors.append(f"{slug}: status is {status!r}, not {GATE_PENDING_STATUS!r} — refusing to approve gates")
            continue
        gates = [re.sub(r"^[-*]\s+", "", l.strip()) for l in pending.split("\n") if l.strip()]
        if not gates:
            errors.append(f"{slug}: no gates under {GATE_PENDING_SECTION!r} — nothing to sign off")
            continue
        limit, err = _standing_limit(note, rollout_note)
        if err:
            errors.append(f"{slug}: {err}; nothing written")
            continue
        # ADR 0038: a note the plan judge bounced went to sign-off on a plan it never approved; nothing on it is the
        # standing approval's to sign, whatever the gate prices. The heading alone counts (fail-closed: an emptied
        # section still refuses).
        bounced = note.has_heading(GATE_BOUNCE_SECTION)
        covered, left = [], []
        for g in gates:
            verdict = gi.covered(g, limit["value"])
            if bounced:
                left.append((g, _bounce_why(verdict, gi)))
            elif verdict["covered"]:
                covered.append((g, verdict["usd"]))
            else:
                left.append((g, _ask_why(verdict, limit, gi)))
        if covered:
            existing = [l for l in note.section_text(APPROVED_GATES_SECTION).split("\n") if l.strip()]
            have = {_norm_gate(l) for l in existing}
            for g, usd in covered:
                if _norm_gate(g) not in have:
                    have.add(_norm_gate(g))
                    existing.append(f"- {g} {gi.annotation(date, usd, limit['value'], limit['source'])}")
            note.upsert_section(APPROVED_GATES_SECTION, "\n".join(existing))
            stage = None
            if left:
                note.upsert_section(GATE_PENDING_SECTION, bullets([g for g, _ in left]))
            else:
                stage, route, ready_pr = _sign_route(note, slug, now)
            note.save(dry_run=args.dry_run)
            # the Standing approval signed these, not Lachy: recorded, and not counted as his act (p21-2)
            _event(_note_rollout(note), "gate-signed", slug, {"standing": True, "gates": len(covered)}, args)
            if stage == "integration":
                _event(_note_rollout(note), "ready", slug, {"pr": ready_pr}, args)
            for g, usd in covered:
                print(f"{slug}: gate approved under the standing approval: {g} (exposure US${gi.format_usd(usd)} of "
                      f"US${gi.format_usd(limit['value'])}, {limit['source']})" + suffix)
            if not left:
                print(f"{slug}: every gate signed under the standing approval -> {route}" + suffix)
        for g, why in left:
            print(f"ASK: {slug}: {g}: {why}")
            asked = True
    for e in errors:
        print(f"ERROR: {e}", file=sys.stderr)
    return 1 if errors else (3 if asked else 0)


# ---- gate-pricer ------------------------------------------------------------

def cmd_gate_pricer(args) -> int:
    """gate-pricer (ADR 0038; the module docstring): the plan judge's pricer path for each task's own call, set only
    while the task's standing approval is on. Read-only: no write, no Run-record event. Exit 0, or 1 on any error."""
    rollout_path = Path(os.path.expanduser(args.rollout))
    if not rollout_path.is_file():
        print(f"ERROR: rollout note not found at {rollout_path}", file=sys.stderr)
        return 1
    if not GATED_INPUTS_PY.is_file():
        print(f"ERROR: gate-pricer: {GATED_INPUTS_PY} not found", file=sys.stderr)
        return 1
    try:
        rollout_note = Note(rollout_path)
    except ValueError as e:
        print(f"ERROR: gate-pricer: {e}", file=sys.stderr)
        return 1
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    errors = []
    for slug in [s.strip() for s in args.tasks.split(",") if s.strip()]:
        path = tasks_dir / f"{slug}.md"
        if not path.exists():
            errors.append(f"{slug}: task note not found at {path}")
            continue
        try:
            note = Note(path)
        except ValueError as e:
            errors.append(str(e))
            continue
        if (_note_rollout(note) or "").lower() != rollout_path.stem.lower():
            errors.append(f"{slug}: its rollout: is {note.get('rollout')!r}, not [[{rollout_path.stem}]]")
            continue
        limit, err = _standing_limit(note, rollout_note)
        if err:
            errors.append(f"{slug}: {err}")
            continue
        on = limit["value"] > 0
        print(json.dumps({"slug": slug, "gatePricer": str(GATED_INPUTS_PY) if on else "", "limit": limit["value"],
                          "source": limit["source"],
                          "why": "" if on else f"standing approval off ({limit['source']} 0)"}, ensure_ascii=False))
    for e in errors:
        print(f"ERROR: {e}", file=sys.stderr)
    return 1 if errors else 0


# ---- clear-pause ------------------------------------------------------------

def cmd_clear_pause(args) -> int:
    """Reinstate: remove `paused:` + any pending `pause_requested` + `paused_for` from the rollout note.

    Called by /thread:execute's resume path ONLY when it finds a `paused:` stamp — a pending
    `pause_requested` with no stamp is a live user request that must survive resumes (the heartbeat
    cron re-enters execute's resume, and it must never cancel a pause the user asked for). Clearing
    both here covers the hard-pause-before-honour edge (stamp hand-written while a soft request was
    still pending) so a freshly reinstated rollout doesn't immediately re-pause.

    Under `paused_for: sign-off` (ADR 0034) it first checks the queue with the pause ignored: while that would still be
    awaiting sign-off (_awaits_sign_off), it writes nothing, prints `STILL-AWAITING: [[<slug>]]: <gate>` per pending
    gate and exits 3, so a reinstate with a gate unsigned never re-runs the sign-off form.
    """
    path = Path(os.path.expanduser(args.rollout))
    if not path.exists():
        print(f"ERROR: rollout note not found at {path}", file=sys.stderr)
        return 1
    note = Note(path)
    stamp = _scalar(note.get("paused"))
    if _valued(stamp) and _scalar(note.get(PAUSED_FOR_KEY)).lower() == SIGN_OFF:
        wait, rows = _awaits_sign_off(path, note, Path(os.path.expanduser(args.tasks_dir)))
        if wait:
            by_slug = {r["slug"].lower(): r for r in rows}
            for w in wait:
                if w["why"] != GATE_PENDING_STATUS:
                    continue
                pending = by_slug[w["slug"].lower()]["note"].section_text(GATE_PENDING_SECTION)
                for line in pending.split("\n"):
                    gate = re.sub(r"^[-*]\s+", "", line.strip())
                    if gate:
                        print(f"STILL-AWAITING: [[{w['slug']}]]: {gate}")
            return 3
    note.remove("paused")
    note.remove("pause_requested")
    note.remove(PAUSED_FOR_KEY)
    note.save(dry_run=args.dry_run)
    if _valued(stamp) and not args.dry_run:
        # The Run record (p15-2): a hard pause whose record-pause never ran is caught up at its stamp first.
        state = _record_state(path.stem)
        if state is None or not state["paused"]:
            at = _parse_ts(stamp)
            _event(path.stem, "paused", None, {"mode": "hard"}, args, ts=at.isoformat() if at else None)
        _event(path.stem, "resumed", None, None, args)
    if note.dirty:
        print("pause cleared (paused/pause_requested/paused_for removed)" +
              (" (dry-run)" if args.dry_run else " [written]"))
    else:
        print("no pause stamp [no-change]")
    return 0


# ---- await-sign-off ---------------------------------------------------------

def cmd_await_sign_off(args) -> int:
    """The sign-off pause (ADR 0034; the module docstring): stamp `paused:` and `paused_for: sign-off`, append the
    `## Pause log` line and record `paused mode=sign-off`, only when the queue with no --running and any pause ignored is
    awaiting sign-off. Exit 1 (nothing written) otherwise; `[no-change]` once stamped."""
    path = Path(os.path.expanduser(args.rollout))
    if not path.is_file():
        print(f"ERROR: await-sign-off: rollout note not found at {path}", file=sys.stderr)
        return 1
    note = Note(path)
    ro = path.stem
    stamp = _scalar(note.get("paused"))
    if _valued(stamp):
        if _scalar(note.get(PAUSED_FOR_KEY)).lower() == SIGN_OFF:
            print(f"{ro}: already awaiting sign-off since {stamp} [no-change]")
            return 0
        print(f"ERROR: await-sign-off: {ro} carries paused: {stamp} (another pause); nothing written", file=sys.stderr)
        return 1
    wait, _rows_ = _awaits_sign_off(path, note, Path(os.path.expanduser(args.tasks_dir)))
    if not wait:
        print(f"ERROR: await-sign-off: {ro} is not awaiting sign-off (something can still start, runs, integrates or "
              "is set aside for another reason: `next` says why); nothing written", file=sys.stderr)
        return 1
    now = _stamp(_now(args))
    named = ", ".join(f"[[{w['slug']}]] ({w['why']})" for w in wait)
    note.set("paused", now, after=("pause_requested", "parallel_ceiling", "status"))
    note.set(PAUSED_FOR_KEY, SIGN_OFF, after=("paused",))
    note.append_line(PAUSE_LOG_SECTION, f"- {now} awaiting sign-off: {named}: sign off, then /thread:execute [[{ro}]]")
    note.save(dry_run=args.dry_run)
    if not args.dry_run:
        state = _record_state(ro)
        if state is None or not state["paused"]:
            _event(ro, "paused", None, {"mode": SIGN_OFF}, args)
    print(f"{ro}: awaiting sign-off: {named} -> paused: {now}, {PAUSED_FOR_KEY}: {SIGN_OFF}"
          + (" (dry-run)" if args.dry_run else " [written]"))
    return 0


# ---- verify-timeout -----------------------------------------------------------

def cmd_verify_timeout(args) -> int:
    """The lead's per-entry check of the rollout's `verify_timeout` and the machine's `verify_slots` (execute § 3,
    p14-2, p23-4). Read-only. Valid: one JSON line {"verifyTimeout": N, "harnessTimeoutMs": 7200000, "slotWait":
    max(60, 7200 - 600 - N), "verifySlots": V, "verifySlot": {"script": <this script's sibling verify-slot.py>,
    "slots": V}}, exit 0: `verifySlot` is the engine's args.verifySlot, copied verbatim (execute § 4). A bad verify_timeout or no note: one ERROR line on stderr,
    exit 1 (checked first). A refused rollouts.toml: `ERROR: rollout settings refused: …`, exit 3. Either way the
    lead's entry writes nothing."""
    path = Path(os.path.expanduser(args.rollout))
    if not path.exists():
        print(f"ERROR: rollout note not found at {path}", file=sys.stderr)
        return 1
    try:
        note = Note(path)
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    seconds, err = _verify_timeout(note)
    if err:
        print(f"ERROR: {err}", file=sys.stderr)
        return 1
    settings, err = _machine_settings()
    if err is None:
        try:
            slots = settings["verify_slots"]["value"]
        except Exception as e:
            err = f"rollout-settings.py failed: no verify_slots ({e})"
    if err:
        print(f"ERROR: rollout settings refused: {err}", file=sys.stderr)
        return 3
    print(json.dumps({"verifyTimeout": seconds, "harnessTimeoutMs": HARNESS_MAX_S * 1000,
                      "slotWait": max(VERIFY_SLOT_WAIT_MIN, HARNESS_MAX_S - VERIFY_HARNESS_MARGIN - seconds),
                      "verifySlots": slots,
                      "verifySlot": {"script": os.path.join(os.path.dirname(os.path.abspath(__file__)), "verify-slot.py"),
                                     "slots": slots}}))
    return 0


# ---- CLI --------------------------------------------------------------------

def main() -> int:
    p = argparse.ArgumentParser(description="Deterministic vault reconcile for a rollout's queue (ADR 0030).")
    sub = p.add_subparsers(dest="cmd", required=True)
    tasks_dir_help = "task-note dir (default: the vault's Work/Tasks)"
    now_help = "the time to stamp or measure against, ISO (default: now)"

    r = sub.add_parser("reconcile", help="write task frontmatter + feedback runs from a workflow result")
    r.add_argument("--result", default="-", help="path to the workflow result JSON, or '-' for stdin (default)")
    r.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    r.add_argument("--now", type=_iso_arg, default=None, help=now_help + " (the run headings' stamp)")
    r.add_argument("--dry-run", action="store_true")
    r.set_defaults(func=cmd_reconcile)

    nx = sub.add_parser("next", help="print the queue's next moves as JSON (start/restart/hold/halt)")
    nx.add_argument("--rollout", required=True, help="path to the rollout note")
    nx.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    nx.add_argument("--running", default=None,
                    help="comma-separated slugs whose task calls are live (default: every in_progress note); "
                         "any other in_progress note is stalled and restarts")
    nx.add_argument("--now", type=_iso_arg, default=None, help=now_help)
    nx.add_argument("--dry-run", action="store_true",
                    help="write nothing (a drained pause is reported, not stamped; a start stamp is reported, not cleared)")
    nx.set_defaults(func=cmd_next)

    for name, func, help_ in (
        ("mark-started", cmd_mark_started, "stamp started: on task notes as they start (first start wins)"),
        ("mark-integrating", cmd_mark_integrating, "stamp integrating: on review notes with a PR (first wins)"),
        ("mark-done", cmd_mark_done, "flip task notes review->done after their merge is confirmed (stamps merged:)"),
    ):
        m = sub.add_parser(name, help=help_)
        m.add_argument("--tasks", required=True, help="comma-separated task slugs")
        m.add_argument("--rollout", default=None, help="rollout note path: also print the progress line")
        m.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
        m.add_argument("--now", type=_iso_arg, default=None, help=now_help)
        m.add_argument("--dry-run", action="store_true")
        if name == "mark-started":
            m.add_argument("--start", choices=START_CHOICES, default=None,
                           help="the start the Run record names (resume: a Lost-call or signed-gate resume; revise: "
                                "a seeded revise); default derived from the note's markers and started:")
            m.add_argument("--arm-repo", dest="arm_repo", default=None,
                           help="p26-3: arm the task window first (git-env-canary.py arm --kind task) against this "
                                "repoPath; with --arm-default, required while the rollout's Project root exists")
            m.add_argument("--arm-default", dest="arm_default", default=None,
                           help="p26-3: the arm's default branch <B> (the call's defaultBranch, else main)")
        m.set_defaults(func=func)

    hb = sub.add_parser("hand-back", help="a set-aside task re-enters at its stage: Integration -> review, its run -> in_progress; "
                                          "refuses a held RACE / UNVERIFIED (exit 2)")
    hb.add_argument("--tasks", required=True, help="comma-separated task slugs")
    hb.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    hb.add_argument("--now", type=_iso_arg, default=None, help=now_help + " (the ready: restamp)")
    hb.add_argument("--answer", default=None, help="a compare-and-swap on the recorded answer (one slug only): hand back "
                    "only while answerRecorded is this stamp with form hand-back, else exit 1 (ADR 0035)")
    hb.add_argument("--dry-run", action="store_true")
    hb.set_defaults(func=cmd_hand_back)

    ra = sub.add_parser("record-answer", help="record Lachy's answer to a set-aside block in ## Repair input, the entry "
                                              "last (ADR 0035; repair § 3b): exit 1 refused, nothing written")
    ra.add_argument("--tasks", required=True, help="the set-aside task's slug")
    ra.add_argument("--rollout", required=True, help="path to the rollout note the task's rollout: names")
    ra.add_argument("--kind", required=True, choices=("needs-you", "decision"),
                    help="needs-you: the note's ## Needs you question (removed in the same save); decision: any other ask")
    ra.add_argument("--ask", required=True, help="the ask, verbatim (for needs-you, the note's question)")
    ra.add_argument("--answer", required=True, help="Lachy's answer, verbatim")
    ra.add_argument("--fingerprint", required=True, help="inputs' fingerprint, or - for a block with none")
    ra.add_argument("--form", choices=tuple(FORM_KEYS), default=None,
                    help="hand-back: a bare hand-back is all that is left; awaiting-repair: repair has work first; "
                         "left: answered, left set aside (required with a fingerprint, refused with -)")
    ra.add_argument("--raise", dest="raise_field", choices=RAISE_FIELDS, default=None,
                    help="the budget the block's humanFix.raise names (or max_review_rounds for a revise with no round left)")
    ra.add_argument("--pr", default=None, help="a confirmed PR URL, written as pr: before the entry")
    ra.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    ra.add_argument("--now", type=_iso_arg, default=None, help=now_help + " (the entry's stamp)")
    ra.add_argument("--dry-run", action="store_true", help="print the outcome and write nothing")
    ra.set_defaults(func=cmd_record_answer)

    li = sub.add_parser("log-integration", help="append the lead's clean-path Integration line (path=lead) to a review note")
    li.add_argument("--tasks", required=True, help="the task slug")
    li.add_argument("--started", required=True, help="the Integration's start (lead-integrate.py stamp)")
    li.add_argument("--anchor", required=True, help="the anchor (40 hex)")
    li.add_argument("--head", required=True, help="the integrated head (40 hex)")
    li.add_argument("--base", required=True, help="the integrated base (40 hex)")
    li.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    li.add_argument("--now", type=_iso_arg, default=None, help=now_help + " (the duration's end)")
    li.add_argument("--dry-run", action="store_true")
    li.set_defaults(func=cmd_log_integration)

    rs = sub.add_parser("resume", help="mark done every linked task whose PR merged into the default branch (p6-8); "
                                       "skip and report a held RACE / UNVERIFIED (exit 3)")
    rs.add_argument("--rollout", required=True, help="path to the rollout note")
    rs.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    rs.add_argument("--gh-bin", default="gh", help="the gh executable (tests pass a stub)")
    rs.add_argument("--now", type=_iso_arg, default=None, help=now_help)
    rs.add_argument("--dry-run", action="store_true")
    rs.set_defaults(func=cmd_resume)

    s = sub.add_parser("status", help="emit JSON situational report for a rollout (read-only; /thread:status)")
    s.add_argument("--rollout", required=True, help="path to the rollout note")
    s.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    s.add_argument("--now", type=_iso_arg, default=None, help=now_help)
    s.set_defaults(func=cmd_status)

    tp = sub.add_parser("touched-phases", help="print --project/--phases lines for the phases a rollout touched (read-only; ADR 0026)")
    tp.add_argument("--rollout", required=True, help="path to the rollout note")
    tp.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    tp.set_defaults(func=cmd_touched_phases)

    ci = sub.add_parser("cited", help="print the paths the rollout's not-yet-merged tasks cite, for execute § 2.7's "
                                      "pushed-base scoping (read-only; ADR 0042)")
    ci.add_argument("--rollout", required=True, help="path to the rollout note")
    ci.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    ci.set_defaults(func=cmd_cited)

    fj = sub.add_parser("fold-journals", help="fold each bound Workflow call's journal into the rollout's Run record "
                                              "as call-journal lines (idempotent; ADR 0032)")
    fj.add_argument("--rollout", required=True, help="the rollout: a note path, [[slug]] or a bare slug (the note is never read)")
    fj.add_argument("--dry-run", action="store_true", help="print what would fold; write nothing")
    fj.set_defaults(func=cmd_fold_journals)

    br = sub.add_parser("bind-run", help="record the Workflow call just launched for a task (run-bound; p15-2)")
    br.add_argument("--tasks", required=True, help="the task slug")
    br.add_argument("--run-id", dest="run_id", required=True, help="the launch's runId (wf_...)")
    br.add_argument("--call", required=True, choices=CALL_CHOICES, help="the call's kind (a resume: the kind it resumes)")
    br.add_argument("--resumed-from", dest="resumed_from", default=None, help="a Lost-call resume: the runId it resumes")
    br.add_argument("--journal-dir", dest="journal_dir", default=None,
                    help="absolute journal dir: the session's workflows/ dir, never the printed Transcript dir "
                         "(default: from CLAUDE_CODE_SESSION_ID's transcript)")
    br.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    br.add_argument("--now", type=_iso_arg, default=None, help=now_help)
    br.add_argument("--dry-run", action="store_true")
    br.set_defaults(func=cmd_bind_run)

    fl = sub.add_parser("free-lane", help="the lead frees the lane at a halt (lane-freed release=halt; p15-2)")
    fl.add_argument("--tasks", required=True, help="the lane holder's slug")
    fl.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    fl.add_argument("--now", type=_iso_arg, default=None, help=now_help)
    fl.add_argument("--dry-run", action="store_true")
    fl.set_defaults(func=cmd_free_lane)

    ho = sub.add_parser("hold", help="the lead's merge or race hold starts or ends (hold-started / hold-ended; p15-2)")
    ho.add_argument("--tasks", required=True, help="the task slug")
    ho.add_argument("--hold", required=True, choices=("merge", "race"))
    ho.add_argument("--state", required=True, choices=("start", "end"))
    ho.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    ho.add_argument("--now", type=_iso_arg, default=None, help=now_help)
    ho.add_argument("--dry-run", action="store_true")
    ho.set_defaults(func=cmd_hold)

    rp = sub.add_parser("record-pause", help="record a hard pause after its hand stamp (paused mode=hard; p15-2)")
    rp.add_argument("--rollout", required=True, help="path to the rollout note")
    rp.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    rp.add_argument("--dry-run", action="store_true")
    rp.set_defaults(func=cmd_record_pause)

    df = sub.add_parser("defer", help="pop task(s) out of a rollout back to open backlog (/thread:repair)")
    df.add_argument("--tasks", required=True, help="comma-separated task slugs to defer")
    df.add_argument("--rollout", default=None, help="rollout note path (optional; asserts membership before deferring)")
    df.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    df.add_argument("--dry-run", action="store_true")
    df.set_defaults(func=cmd_defer)

    de = sub.add_parser("descope", help="record an automatic descope of a plan-blocked task (p14-4): exit 0 descoped "
                                         "(then hand-back), exit 3 ASK (the refusal recorded; /thread:repair asks Lachy)")
    de.add_argument("--tasks", required=True, help="the plan-blocked task's slug")
    de.add_argument("--rollout", required=True, help="path to the rollout note the task's rollout: names")
    de.add_argument("--part", required=True, help="the descoped part, a verbatim quote (of the brief, for --optional)")
    dm = de.add_mutually_exclusive_group(required=True)
    dm.add_argument("--optional", action="store_true", help="the part is optional in the note (files a follow-up)")
    dm.add_argument("--owner", default=None, help="the slug of the later task in the same rollout that owns the part")
    de.add_argument("--short", default=None, help="with --optional: the follow-up's kebab name, <project>-followup-<short>")
    de.add_argument("--owner-quote", dest="owner_quote", default=None,
                    help="with --owner: a verbatim quote from the owner's note")
    de.add_argument("--reason", required=True, help="one line: why the feedback centres on the part")
    de.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    de.add_argument("--now", type=_iso_arg, default=None, help=now_help + " (the stamps)")
    de.add_argument("--dry-run", action="store_true", help="print the outcome and write nothing")
    de.set_defaults(func=cmd_descope)

    ar = sub.add_parser("auto-retry", help="execute's automatic retry of one set-aside task (p16-4, ADR 0033): exit 0 "
                                           "re-entered, 1 not retryable (nothing written), 2 a RACE / UNVERIFIED hold")
    ar.add_argument("--tasks", required=True, help="the set-aside task's slug")
    ar.add_argument("--rollout", required=True, help="path to the rollout note the task's rollout: names")
    ar.add_argument("--auto-retries", dest="auto_retries", type=int, default=None,
                    help="assertion: inputs' autoRetryBudget.autoRetries.value (a mismatch refuses)")
    ar.add_argument("--fingerprint", default=None, help="assertion: inputs' fingerprint (a mismatch refuses)")
    ar.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    ar.add_argument("--now", type=_iso_arg, default=None, help=now_help + " (the stamps and a retry cool-down)")
    ar.add_argument("--dry-run", action="store_true", help="print the outcome; write and record nothing")
    ar.set_defaults(func=cmd_auto_retry)

    ca = sub.add_parser("carry", help="re-point a superseded rollout's unlanded tasks to its successor (/thread:schedule)")
    ca.add_argument("--from", dest="from_", required=True, help="path to the prior (superseded) rollout note")
    ca.add_argument("--to", default=None, help="path to the new rollout note (required unless --dry-run)")
    ca.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    ca.add_argument("--dry-run", action="store_true", help="print the carry/keep lines and write nothing")
    ca.set_defaults(func=cmd_carry)

    cp = sub.add_parser("clear-pause", help="reinstate a paused rollout: remove paused/pause_requested/paused_for "
                                            "(/thread:execute resume); exit 3 STILL-AWAITING under a sign-off pause "
                                            "whose gates are unsigned (ADR 0034)")
    cp.add_argument("--rollout", required=True, help="path to the rollout note")
    cp.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    cp.add_argument("--dry-run", action="store_true")
    cp.set_defaults(func=cmd_clear_pause)

    aw = sub.add_parser("await-sign-off", help="pause a rollout whose only unlanded tasks wait on a gate: stamp paused: + "
                                               "paused_for: sign-off and a ## Pause log line (ADR 0034; execute § 4.5 "
                                               "step 5's sign-off form); exit 1 when the queue is not awaiting sign-off")
    aw.add_argument("--rollout", required=True, help="path to the rollout note")
    aw.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    aw.add_argument("--now", type=_iso_arg, default=None, help=now_help + " (the paused: stamp)")
    aw.add_argument("--dry-run", action="store_true")
    aw.set_defaults(func=cmd_await_sign_off)

    vt = sub.add_parser("verify-timeout", help="print the rollout's verify_timeout, the harness timeout, the verify-slot "
                                               "wait and the machine's verify_slots as JSON; exit 1 on a bad "
                                               "verify_timeout, 3 on refused rollout settings (read-only; execute § 3)")
    vt.add_argument("--rollout", required=True, help="path to the rollout note")
    vt.set_defaults(func=cmd_verify_timeout)

    ag = sub.add_parser("approve-gates", help="record a sign-off for a gate-pending task's gated inputs: Lachy's explicit "
                                              "one, or with --standing the standing approval's (ADR 0008, ADR 0034)")
    ag.add_argument("--tasks", required=True, help="comma-separated task slugs (must be at status gate-pending)")
    ag.add_argument("--standing", action="store_true",
                    help="sign only the spend gates the standing approval covers (spend_approval_usd: task, rollout, "
                         "rollouts.toml, built-in 0 = off); the rest stay pending as ASK lines: exit 0 all signed, "
                         "3 some left, 1 an error (ADR 0034)")
    ag.add_argument("--rollout", default=None,
                    help="with --standing (required there): the rollout note, whose frontmatter and Project root "
                         "resolve spend_approval_usd; the task's rollout: must name it")
    ag.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    ag.add_argument("--date", default=None, help="sign-off date stamped on each gate (default: today)")
    ag.add_argument("--now", type=_iso_arg, default=None, help=now_help + " (the ready: restamp of a stop at Integration)")
    ag.add_argument("--dry-run", action="store_true")
    ag.set_defaults(func=cmd_approve_gates)

    gpr = sub.add_parser("gate-pricer", help="print each task's plan-judge pricer path (gated_inputs.py) as JSON, \"\" "
                                             "while its standing approval is off; read-only (ADR 0038)")
    gpr.add_argument("--tasks", required=True, help="comma-separated task slugs")
    gpr.add_argument("--rollout", required=True,
                     help="the rollout note, whose frontmatter and Project root resolve spend_approval_usd; the "
                          "task's rollout: must name it")
    gpr.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    gpr.set_defaults(func=cmd_gate_pricer)

    args = p.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
