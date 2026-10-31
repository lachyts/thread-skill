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
              (see the Status mapping below). A row that ends a Slot (its note read in_progress; no integrate
              row) is its call's end (p29-12): `ready:`, a read-only approval's `merged:` and the row's Slot
              events are stamped at the end the journal of the call bound to the task's open Slot records
              (_call_end: its run-bound line in the Run record, then <journalDir>/<runId>.json), not when the
              lead reconciles, which can be hours later (a lead held on a hold, or idle). The end must lie at
              or after the Slot's latest slot-taken (a re-take included), or the Slot would split for a reader
              by ts. With no end readable they fall back to now, and the row's line marks it: `ready=<stamp>
              (fallback)`. --no-verdict (the integrate call's canary check exited 4, a trip inside its window
              acked before the check, ADR 0053): an `integrated` row's line reads `void` instead, so it never
              backs prepare's case (ii), and the lane frees (`lane-freed release=halt`); the task waits for
              Integration again. A row with any other outcome is reconciled as usual, except that no integrate
              row's `flakes` are recorded (one line says so): that window's runs give no verdict.

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
              An unacked git-env trip (Git-env hold, below) is listed as `gitEnvHold`, each with its `scope`: a
              bare checkout's (`rollout`) holds every start and makes `halt` "git-env" at once, ahead of every other
              verdict; any other trip holds the Integration lane only. `laneHold` (after `gitEnvHold`) is what holds
              the lane: one {slug, hold: "git-env"} per unacked trip's slug, in log order, then one {slug, hold:
              "race", revert} per undecided RACE in `raceHold`, in rank order, that is not reverted on main, or whose
              revert the lead still owes (`revert: true`: started, not failed, its `integrating:` standing; the lane's
              first work, execute § 4.5 step 1.4), or that was reverted with `main not re-verified` (Race holds,
              below), then one {slug, hold: "lane", cause, stamp} per unacked `## Lane log` hold (Lane hold, below),
              in log order. `mainRed` (after `laneHold`, _main_red) is every RACE whose revert did not land that no `RACE
              decided:` line lifts, [{slug, why, stamp}]: while it is non-empty nothing starts or restarts, every
              stalled or queued task is held (`main red: the revert of [[<first>]] did not land: /thread:repair`) and
              `halt` is "race" at once, whatever runs, pauses or holds; only a whole-rollout git-env hold outranks it
              (its `git-env hold:` reasons win). `awaitingIntegration` is the Integration queue's order: a task a queued
              task depends on, directly or through a folded member (`merged_into:`), first, then the oldest
              `ready:`, then schedule order. Each `setAside` entry is {slug, status, setAsideAt}, plus `needsHuman`
              (p16-3: the note's `## Needs you` question, normalised) only when the note holds one. `halt` is
              "git-env" under a whole-rollout git-env hold, else "race" while `mainRed` is non-empty; otherwise it is
              null while anything starts, restarts or runs, or while the lane moves (`laneHold` empty and something
              awaits Integration, integrates or holds the lane for a RACE re-verify; or a `race` entry reads `revert:
              true` and no `git-env` or `lane` entry stands); otherwise the first of "git-env" (a lane `git-env`
              entry), "race" (a `race` entry with `revert: false`), "lane" (a `lane` entry), "paused", "empty",
              "complete" (or "done"), "held",
              "awaiting-sign-off" and "stuck". Two halts sit outside that list (p30-4, Approved queue below):
              "superseded", returned at once for a note with a valued `superseded_by:`, before its ceiling is read,
              and "regenerate", set whenever an approved queue's verdict regenerates and no git-env trip, `mainRed`
              entry or `laneHold` entry stands (each halts first, ADR 0046), ahead of every other verdict, "empty"
              included. So the order is superseded > git-env (whole) > race (main red) > regenerate > git-env (lane)
              > race (lane) > lane > paused > empty > complete/done > held > awaiting-sign-off > stuck. `git-env`
              (lane), `race`, `lane`, `stuck` and a task-scope `held` are the lead's to act on only after execute
              § 4.5 step 1.5's wait clauses, because `next` cannot see step 1.2's cool-downs or its cap-held
              revises; a `pause_requested` behind a lane verdict never drains while the note keeps `integrating:`.
              With every
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
              The Trickle and the Away cap (Chorus ADR 0104; ADR 0049; Trickle and Away, below): `slotLimit` (an
              int) and `trickle` ({away, file, why, limit, awayCap, until, morning, elsewhere, lapsed, running,
              kept}) follow `slotsInUse`; every other key, `ceiling` included, is unchanged. A start stops at the
              Mac-wide cap (the Trickle N not Away, the Away cap A Away) less the tasks running in every other open
              Rollout on the Mac whose lead's lease has not lapsed (p28-4; `lapsed` names the others, {<rollout>:
              n}), less the places a fair share keeps for waiting rollouts (p28-5; `trickle.kept`), and less this
              rollout's own in_progress tasks, live or stalled; a restart stops at the ceiling only. Off --dry-run,
              once the refusals pass, it rewrites this rollout's lease; a failure prints one `lease: warning: …` line
              on stderr. A row held there reads `trickle: <running>/<N> tasks running on this Mac` (not Away) or
              `away cap: <running>/<A> tasks running on this Mac` (Away), with `, <k> kept for [[<rollout>]], …`
              after either while a fair share keeps places, and while one is, `halt` stays null. A stale or
              unreadable state file prints one `WARN: ~/.config/thread/away.json …` line on stderr, --dry-run
              included. `trickle.elsewhere` and `running` count every other lead's live Trickle claims too (p28-3;
              Trickle and Away, below): off --dry-run `next` writes this rollout's, one per start, under the trickle
              claim lock. Off --dry-run `next` also writes this rollout's waiting record under the same lock, in the
              same write (p28-5; Trickle claims, below). A claims file it cannot read (--dry-run included), a lock it
              cannot take or a write that fails prints one `WARN: trickle claims …` line (TRICKLE_WARN) and never
              fails the call.
              The last starts (Chorus ADR 0104 d4; The last starts and the night record, below): `lastStarts`
              ({morning, kinds}) follows `trickle`. While Away runs to the Morning, a start whose kind's usual
              length would end past it reads `last start: …` and is skipped, never a stop; a restart never does;
              while one is held, `halt` stays null. Off --dry-run, the night record's lines follow idle-slots.
              A PR hold (Hold until, below; --gh-bin, default `gh`): `holdUntil` lists each hold this call read, the
              rollout's first, then the tasks' in rank order, as {note, scope: rollout|task, pr, url, state, error, held,
              waits: merge|you|null, cleared}, and is [] with gh never called when no note it reads carries one (every
              other key byte-identical). A rollout hold that stands, unless a pause stands (it wins), starts and
              restarts nothing and holds every stalled or queued task with its reason; git-env still wins over it. A
              task's own hold is read only while no pause and no rollout hold stands, on a stalled task, a queued one
              whose dependencies are met or one set aside at its run or a gate: it holds that task's new call (a held
              Solo task holds nothing), and a held setAside entry gains `holdUntil: "<reason>"`. "held" is the halt when
              nothing starts, restarts, runs, awaits Integration or integrates, no Trickle, Away-cap, last-starts or
              heat hold stands and any entry holds; a MERGED hold releases at once and, off --dry-run, is removed from
              its note (`cleared`: true only once no `hold_until` stands on the note after the save, so a hold
              rewritten meanwhile, which the compare-and-swap keeps, reads false), except an approved queue's, whose
              verdict may keep it standing. `onMerge` and `supersededBy` follow `holdUntil`: the approved queue's
              verdict ({note, pr, url, action: regenerate|waits|released, members, successor, why, detail}) or null,
              and the superseded backstop's successor or null. A superseded note's output is {halt: "superseded",
              supersededBy, progress} with every other key at its empty value: no ceiling read, no gh call, no write,
              no event.
              The Heat hold (estate ADR 0009 d5; Heat hold, below): `heat` ({level, name}) follows `lastStarts`. At
              heavy or worse `slotLimit` is 0, Away too, so nothing new starts; a restart stops at the ceiling only. A
              row held there reads `heat: the Mac is hot (<name>)` (a full ceiling still reads `ceiling:`), and while
              one is, `halt` stays null.

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
              `ERROR: <slug>: the task window's arm exited <rc>; nothing written` line. A task arm never exits 9: under
              a lane hold (ADR 0046) it arms, printing its `LANE HOLD:` lines. Exit 3 when any arm exited 3
              (a whole-rollout hold); else 2 (an arm failure or refusal, a missing or unpaired flag, the flags with no
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
              `rollout:` names), or whose `pr:` the RACE revert reverted on main (_reverted_pr), is refused
              first, --dry-run included: exit 2, one ERROR line per held task
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
              <repoPath>`, so the note's pr: reads as the same PR URL or `prUrlError`): an `autoRetryError` (an invalid
              round-budget stamp: `auto_retries` or `max_review_rounds` through _retry_budget, `max_iterations` or
              `max_plan_rounds` through _round_budget_error) is exit 1, and the task stays set aside under H12, never a
              halt (ADR 0048): the lead reaches this only by hand or after the note changed, since an `autoRetryError`
              always comes with `autoRetry: false`; --auto-retries and --fingerprint are assertions the lead copies from `inputs`,
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
              minutes (_whole_minutes, the engine's wholeMinutes); triggers `-`; active the duration less
              the stalls inside [--started, --now]: the stops the rollout's Run record logs and the Mac's
              sleeps it does not hold yet (p29-13, _active_minutes; no call, so no journal is read). A
              re-run of the same Integration (same --started and SHAs)
              is a no-op, even at a later --now or after a later-inferred stop. Changes no status,
              rounds, `rung:`, `integrating:` or `ready:`. Refuses (exit 1, nothing written) a note
              that is not `review` with a `pr:`, a SHA that is not 40 hex and a --started that is not an
              ISO stamp.

  resume      A task whose PR merged but whose note was never marked (p6-8): for each linked note that
              is not done, merged or dropped and carries `pr:`, ask gh for the PR's state and base. A PR
              MERGED into the repo's default branch flips the note to done with `merged:` from mergedAt.
              Anything else (merged into another base, OPEN, CLOSED) is reported and left alone, and so is a
              task whose `pr:` the RACE revert reverted on main (_reverted_pr: a `[no-change]` line, before any gh
              call: re-land it through a new `pr:` or defer). A task an
              undecided RACE or UNVERIFIED holds (Race holds, below) is skipped before any gh call: one
              stderr `HOLD:` line names it and `/thread:repair`, the note is untouched, and the verb exits
              3 (which takes precedence over 1; ERROR lines still print).

  status      Read-only situational scan for /thread:status. Given a rollout note, find every task note
              carrying `rollout: [[<this-rollout>]]` (glob-by-backlink — captures read-only tasks the
              `## File-sets` block omits) and emit JSON {rollout, rolloutPath, rolloutStatus, paused,
              pause_requested, pausedFor, incomplete, ceiling, ceilingError, ceilingCause, counts, progress, timeline,
              trickle, ladder, gitEnvHold, laneLog, mainRed, holdUntil, tasks}; `trickle` (p28-6) is `next`'s trickle block read the same
              way, silently (no WARN), plus `here` and `lease`: {away, file, why, limit, awayCap, until, morning,
              elsewhere, lapsed, here, running, lease}, `here` this rollout's own count as another lead's count
              elsewhere reads it (0 while its own lease reads lapsed), `running` elsewhere plus here and `lease` its
              own lead's lease, {state: fresh|lapsed|room-stop|none|unreadable, writtenAt, lapsesAt} (p28-4; Trickle
              and Away, below); it writes no lease; `pausedFor` is the rollout's `paused_for` (`sign-off` under
              await-sign-off's pause, ADR 0034), else null; `ceiling` is `parallel_ceiling`, or for a note without
              it the operator's rollout settings (rollout-settings.py for the Project root: rollouts.toml, then
              built-in 4),
              and null with `ceilingError` the reason when it is invalid or cannot be resolved (`next`
              exits 1 on the same error; status still exits 0), else `ceilingError` is null; `ceilingCause`
              is what the error needs: `stamp` (the note's own value is invalid), `file` (rollouts.toml was
              refused), `root` (the Project root is gone or its origin unreadable) or `resolver`, else null;
              `gitEnvHold` is the unacked git-env trips (Git-env hold, below), each with its `scope`, [] when none;
              `laneLog` is the unacked Lane holds (Lane hold, below), each {slug, cause, stamp, line}, [] when none;
              `mainRed` is `next`'s (_main_red: the RACE reverts that did not land, undecided), [] when none; `incomplete`
              is why the rollout must not run as written (below), or null. `ladder` is {source, rungs (names,
              bottom first), error}: the local ladder file through ladder.py's load(); a refused file gives
              rungs [], source ladder.py's default_path() and error its reason, and status still exits 0.
              Each task carries `rung` (its `rung:` stamp, or null) and `rungDrift`: the stamp when a
              readable ladder lacks it and the task is unlanded (queued, running, awaiting-integration,
              integrating, set-aside), else "". A set-aside task whose note holds a `## Needs you`
              question also carries `needsHuman` (p16-3, normalised); no other task carries the key. A task
              set aside at Integration whose latest run opens a named marker (p27-4, integration_block) also
              carries `integrationBlock`: `conflict` (an Integration conflict, `integration: conflict
              unresolved in …`) or `red` (`integration: verifier red: …`); the key is absent otherwise. `holdUntil`
              (p30-3, Hold until below), at the top level for the rollout and on every task row: its hold_until as
              parsed, {pr, url, error}, or null; the PR's state is never read here. `onMerge` (p30-4, Approved queue
              below): the note's on_merge as read, {value, error}, on a parallel note carrying a rollout hold_until,
              else null; `chainStart`: {prior, pr} when the note is a chain's N never started, unstamped and not
              started by the Stage, whose `supersedes:` prior carries `on_merge: regenerate` (_chain_start), else
              null. Pure read; no network.

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

  record-entry  `--rollout <note> --by lachy|stage|watchdog|heartbeat|repair [--cause usage-limit|dead-lead|watchdog]
              [--session ID] [--now T] [--dry-run]` (p29-10, ADR 0051; execute § 4.5 *Run record*): the lead's loop
              entry in the Run record, run at every loop entry (right after § 2's lineage, version and shape lines) and
              by every heartbeat tick that finds no pause or room stop (its clause 2b). It writes only the Run record
              and the lead's lease (p28-4, renewed before the record is read; Trickle and Away, below): the stops the
              record does not hold yet, as inferred `stopped` lines, then exactly one `lead-entry` {by,
              session?, stop?} (cmd_record_entry holds the rule: the gap stop, first match a standing pause, the open
              stop, --cause, a boot after the latest live line, a session change but on --by heartbeat, --by
              watchdog; every boot or sleep before it written first). --session defaults to CLAUDE_CODE_SESSION_ID.
              The Mac's evidence is machine_times: kern.boottime, kern.waketime, and `pmset -g log` at most once per
              wake (THREAD_MACHINE_TIMES replaces every read). A pause invocation runs none (it is no loop entry). A
              serial, superseded, done or dropped note prints `[skip] <stem>: <why>: no entry recorded` and writes
              nothing, no lease either. Prints one line naming what it wrote (`(dry-run)`: nothing written, no
              lease); a lease it cannot write prints one `lease: warning: …` line on stderr. Exit 0 (written, skipped,
              or a warned write failure); 1 no rollout note (an ERROR line); 2 usage and the Engine snapshot guard.

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
              `## Repair input` line without `(automatic)`, `## Approved gates`, `## Gated inputs`; never a `## Decided for
              you…` section, an agent's call, ADR 0054) holds the part
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
              or `(dry-run)`. A --from carrying `hold_until` (Hold until, below) prints, after the carry, keep and
              restamp lines and before the order lines, `hold_until pr=<pr> merged=<value>` or `hold_until unreadable:
              <why>`; off --dry-run its lines are copied verbatim into --to (Note.insert_block, after `parallel_ceiling:`,
              else `status:`) before any task write, only while --to has none (--to then counts in `[written: <n>]`),
              and a different hold already on --to is kept with `WARN: carry: hold_until on <to> differs from
              <from>'s; <to>'s kept` on stderr. An approved queue's `on_merge:` is never copied (p30-4): the new note
              keeps a plain hold, released at its first `next`.
              --dry-run previews and needs no --to. Refuses (exit 2,
              nothing written, one ERROR line): a --from that is missing, unparseable, not tagged `rollout`,
              done or dropped (unless done with `superseded_by:` naming --to: a re-run), or neither paused
              nor never started (or an approved queue whose only marks are ended room stops: approved_unrun); a
              --from with a task an undecided RACE or UNVERIFIED holds (--dry-run
              included; the line names each held slug and `/thread:repair [[<from>]]`); a --from with an
              unacked git-env trip (Git-env hold, below; --dry-run included; `ERROR: carry: --from <stem> holds
              an unacked git-env trip: [[a]], [[b]]: record Lachy's ack first with /thread:repair [[<stem>]]`,
              checked after the RACE hold); a --from with an unacked Lane hold (Lane hold, below; --dry-run
              included; `ERROR: carry: --from <stem> holds an unacked Lane hold: [[a]]: record Lachy's ack first
              with /thread:repair [[<stem>]]`, checked after the git-env hold: the carry strips `integrating:` and
              never copies the `## Lane log`, so the held task would integrate unacked); a carried note that
              needs the top rung when the ladder file is refused (--dry-run included; `ERROR: carry: ladder
              file refused: <path>:<line>: <reason>`, no stdout); a --to that is
              missing, not directly in the tasks dir, untagged, done or
              dropped, whose `supersedes:` does not name --from, that is --from, or that is not never
              started; no --to without --dry-run. A failed save is exit 1 at once: the prior note is still
              open, so the next unfinished-rollout check pairs the two notes as interrupted.

  approve-queue  `--rollout <note> --pr <owner/repo#N | PR URL>` (p30-4; Approved queue below): run on Lachy's words
              naming a queue and its gating PR (execute § Invocation forms, orient § 9, schedule step 8). Writes, in one
              locked save, `hold_until: {pr: <ref>, merged: true}` (after `parallel_ceiling:`, else `status:`),
              `on_merge: regenerate` right after it, and `start: unattended` below `status:` unless a valued
              `started_unattended:` stands; a key already at its value is not rewritten. Exit 0 prints one line, `undo:
              remove hold_until, on_merge and start: unattended from [[<note>]] before <pr> merges, or pause [[<note>]]
              once its lead runs` (with no start stamp, `remove hold_until and on_merge`); a hold that stood before the
              run, his own or an earlier run's, is never named (`remove on_merge and start: unattended`, or `remove
              on_merge`), so following the line never drops a hold he wrote. Refuses (exit 1, one `ERROR:
              approve-queue:` line, nothing written): a note not found, serial, incomplete, done or dropped, superseded,
              paused or pause-requested, one _approved_marks reads as run (room stops and an `integrating:` stamp never
              refuse: the verdict judges them at the merge), an unreadable --pr ("name the PR as owner/repo#N or its
              URL"; no gh call), a standing hold on another PR (by canonical key: a bare-number hold, read in the
              Project root, never matches, and is told "rewrite it as owner/repo#N first, or remove it") or an
              unreadable one, and an `on_merge:` of another value. Exit 2 is usage.

  stamp-start  `--rollout <note>` (p30-4): schedule step 8 under the chain, after step 7.5, stamps `start: unattended`
              below `status:` on the note an approved queue's regenerate wrote (no write when it is already there) and
              prints `undo: remove start: unattended from [[<note>]] before the Stage starts it, or pause [[<note>]]
              once it runs; it superseded [[<prior>]] when <pr> merged`. Refuses (exit 1, one `ERROR: stamp-start:`
              line, nothing written): not found, serial, incomplete (so it runs after step 7.5, which closes the prior),
              closed, superseded, paused or pause-requested, not never started, a valued `started_unattended:`, or no
              `supersedes:`.

  verify-timeout  Read-only, for /thread:execute § 3's once-per-entry check (p14-2, p23-4): given a rollout
              note, print one JSON line {"verifyTimeout": N, "harnessTimeoutMs": 7200000, "slotWait":
              max(60, 7200 - 600 - N), "verifySlot": {"script": <abs verify-slot.py>, "slots": V}} from its
              `verify_timeout` frontmatter (an integer
              from 1 to 6600; absent -> 1800; a quoted value or a trailing ` # comment` is read as
              `parallel_ceiling` is) and the machine's `verify_slots` (rollout-settings.py resolve(repo=None):
              rollouts.toml's [defaults], else the built-in 2; never read from the note). harnessTimeoutMs is
              the harness maximum; slotWait bounds the lead verify's wait for a verify slot, so the wait, the
              verifier and the 600 s margin fit inside it. A bad `verify_timeout`, or no note: one ERROR line on
              stderr, exit 1, no stdout (checked first). When the note declares `completion_verifier:`, a value of
              it, `env_bootstrap:` or `completion_timeout:` that completion-verify would refuse: its ERROR line,
              exit 2, no stdout (argparse's own usage error is exit 2 too; its line names no key). The note's
              `named_rerun:` (p29-9, ADR 0050: the repo's runner for named tests, the lead's Flake check's named
              re-run) is read the same way (_named_rerun: completion_verifier's reader, plus `{tests}` exactly once);
              set, the line gains `"namedRerun": "<cmd>"` after `verifySlot`, absent or empty no key; a value it
              refuses is exit 2 like a completion key's. A refused
              rollouts.toml (the whole file is validated), a present one on a python with no tomllib, or a resolver
              that will not load: `ERROR: rollout settings refused: <the resolver's line>`, exit 3, no stdout. No
              verify-slot.py beside this script (p32-1, checked after exit 3): `ERROR: verify-timeout: <path> not
              found`, exit 4, no stdout.

  record-verify  The lead's record of one Integration verify or RACE re-verify (ADR 0050, 0051; execute § 4.5 step 3
              and the RACE procedure), run only once that verify's canary check exited 0: `--rollout <note> --tasks
              <slug> --site integration|race --from <out>.flake.json [--now] [--dry-run]`, the file lead-integrate.py
              verify --diff-base wrote. Verdict `flake`: each first-run failing id is a Flake, logged and filed by
              _record_flakes (below) with --site and the file's sha. A `timeout` ({run: first | named | confirm,
              seconds}): one `suite-timeout` event, logged as load, never a Flake. A green or another red records
              nothing. Then `recorded: <stamp>` is written into the file (tmp + rename), so a second call prints
              `[no-change]` and records nothing. No file at all (verify writes none when its verifier never ran:
              `noslot`, a failed env_bootstrap): one `nothing to record` line, exit 0. Exit 1, one ERROR line, the
              file unstamped: an unreadable or malformed file (not v 1 with a verdict green | flake | red), a task
              note not found or whose `rollout:` is not --rollout, a follow-up that could not be written. --dry-run
              prints what it would record and writes nothing, the file included. Not exempt from the Engine snapshot
              guard.

  completion-verify  The completion verify (estate ADR 0009 d6, Chorus ADR 0107 d1, ADR 0052, ADR 0055; execute § 4.5
              step 5, legs.md § Complete): a rollout whose note declares `completion_verifier: <cmd>` runs it once on
              merged origin/<default>, a serial chain's on its checkout's HEAD (below), before the note reads done; a
              note with none keeps the ceremony as it was. The value (and
              `env_bootstrap:`, read the same way): a quoted one is the text inside its quotes, then nothing but an
              optional ` # comment`; a bare one drops an inline ` # comment` (so a command holding ` #` is quoted);
              empty, a comment alone, `null` or `~` is none; a YAML boolean (`true`, `false`, `yes`, `no`, `on`,
              `off`) or a quoted comment is exit 2, never run as a command. A form the reader cannot represent
              exactly (a value continued on an indented next line, an escape inside double quotes, text after the
              closing quote, a bare value starting with a YAML indicator or `- `, holding `: ` or ending in `:`) is
              exit 2, never truncated into another command; so is a `completion_timeout:` that is not an integer
              from 1 to 6600 (absent, empty or a comment alone: 3600, the deadline the env_bootstrap and the full
              suite share, never verify_timeout's). Read mode, read-only: one JSON line. With none, {"verifier":
              null, "state": "absent"}. Otherwise {verifier, state, attempt, sha, repo, tree, out, streak, followup,
              summary}: state `run` (no verdict yet: attempt 1, on a fresh origin/<default> or a serial chain's HEAD,
              sha null), `rerun`
              (attempt 1 was red: attempt 2 on its sha), `in-flight` (a --run holds the attempt's lock, `<git common
              dir>/thread/completion-<rollout>-<n>.lock`, probed shared), or the decided `green`, `flake` or `red`.
              repo is the note's `Project root:` (none: exit 1), or a `shape: serial` note's one `repo:` surface
              (serial-chains.py's grammar), which must be a git toplevel (`git -C <token> rev-parse --show-toplevel`
              is the token: the test leg.py claim stamps a `leg_base` by; zero, several or not a toplevel: exit 1);
              tree and out the attempt's own `<repo>/.claude/worktrees/completion-<rollout>-<n>` and
              `<repo>/.claude/integration/completion-<rollout>-<n>`, a serial chain's outside its checkout's working
              tree (ADR 0055): `<state>/thread/completion-trees/completion-<rollout>-<n>` (THREAD_COMPLETION_TREE_DIR
              when absolute, else XDG_STATE_HOME's, else ~/.local/state's thread/completion-trees) and `<git common
              dir>/thread/completion-<rollout>-<n>`, beside the lock; streak the `noslot` and `unrun` lines at the
              log's tail (a `stopped` or `heat` one skipped); followup the fix task's stem once red; summary the
              Completion log's one line once decided.
              --wait [SECONDS] (read mode only: with --run, or a value outside 1 to 7000, exit 2; ADR 0055, a serial
              Leg's, which has no heartbeat): while the state reads `in-flight` it reads the note and the lock again
              every 2 s, up to SECONDS (default 7000, COMPLETION_WAIT_S: inside the background command's 7200000 ms
              cap, and past any attempt's verify under ADR 0052's budget), then prints the read, `in-flight` still
              at its deadline. Any read, with --wait or without, prints a note read after a free probe of the
              attempt's lock: --run writes its line under that lock and frees it only as it exits, so a probe that
              finds it free reads the note once more, and a run that ended between the note read and the probe
              prints as its line, never as the state before it. It returns at once when nothing is in flight (and
              with no fcntl), writes, arms and records nothing, and a signal ends it with no line; its exit 1 and 2
              are the read's.
              --run owns one attempt end to end under that lock (retried for 2 s past a reader's probe), held for
              its whole life (the lead launches it in the background and reads again when it ends). Decided already,
              it runs nothing. Otherwise, under the lock it reads the note again, clears a dead run's tree, resolves
              origin's default branch (default-branch.sh; each origin read bounded by 120 s) and the sha (attempt 1:
              fetch `+refs/heads/<default>:refs/remotes/origin/<default>`, then that ref; attempt 2: the red run's),
              arms the git-env canary (`--kind completion-verify --slug <rollout>`; a serial chain's --run reads no
              origin and arms no canary, below), runs `lead-integrate.py verify
              --outcome --detach-at <sha>` as its child (inheriting the lock) (the machine's verify slots,
              `--timeout <completion_timeout>`, the slot wait max(60, 7200 - 600 - completion_timeout - the seconds
              --run has spent so far), the env_bootstrap), checks the window once, and classifies the run from
              verify's outcome file alone, never its log's text: no outcome, `running`, `bootstrap`, or a deadline
              in the env_bootstrap is `unrun`; `noslot` is `noslot`; `heat` (the Heat hold outlasted the slot wait:
              the Mac was too hot to run the suite) is `heat`; `signal` is `stopped`; a deadline in the
              verifier is red at once, since a timeout names no failing test and is never a Flake (ADR 0050); `done`
              with rc 0 is green on attempt 1 and a Flake on attempt 2 (recorded, no task); any other `done` is
              `rerun` on attempt 1 (its line naming up to ten failing ids read from the log, the Flake log ADR 0050
              keeps) and red on attempt 2; a stop signal to --run while verify runs (a TaskStop, a hard pause, a
              room stop) is forwarded to verify once, and the run is `stopped` whatever it ends with; one before
              verify starts ends any origin read and exits 128+n at the next checkpoint with no line (the attempt
              runs again); one after verify ended on its own leaves its verdict standing. A git-env trip inside the
              window (its own check's exit 3, or its exit 4: one a loop-entry check-all caught and an ack re-armed
              meanwhile, ADR 0053) makes it `unrun` whatever the rc. A serial chain's --run (ADR 0055): attempt 1's
              sha is its checkout's HEAD as the run starts (it never pushes, so that is its merged main), attempt
              2's the red run's; before anything runs, the HEAD guard checks that sha holds the chain's work: every
              done linked task (the `rollout:` backlink, Archive included) with a `leg_base` in the checkout anchors
              it with its `leg_head` there (leg.py done's stamp, the task's own newest trailered commit; none when
              it committed nothing there, `[]`), or with that `leg_base` when it has no `leg_head:` key (done before
              ADR 0055); each anchor must be an ancestor of the sha. No such task, or an anchor not in it, is exit 1
              with its remedy (check out the branch, then leg.py clear-halt), nothing run or recorded. Its fix task
              names the chain's checkout, never merged main or an Integration. It
              keeps the log as `<out>.<run id>.log`, files the fix task on a final red
              (`<tasks-dir>/completion-red-<rollout>.md`, open, priority high, `projects:` copied,
              `completion_red_of:` naming the rollout; the sha, the rc and why, the log and the failing ids read
              from it; never a second one when it exists in the tasks dir or its Archive), then appends one `##
              Completion verify log` line, the commit point, `- <stamp> attempt <n> at <sha> rc <rc|absent> ->
              <result>: <why> (run <id>; log <kept log>)`, records `completion-verify` {result, rc, sha, attempt,
              log, followup?} in the Run record and prints {ran: true, result, decided, attempt, streak, halt, line,
              followup}: halt is true at the third `noslot` or `unrun` in a row since the last halt
              (COMPLETION_HALT_STREAK). A --run that dies before its line leaves a free lock and no line: the same
              attempt runs again, never counted. When it runs nothing it prints {ran: false, state, result, decided,
              attempt, streak, halt: false}. Exit 0: recorded, or nothing to run. Exit 1: nothing recorded (origin
              unread, a git dir it cannot read, refused rollout settings, a file it could not write, no fcntl, a sha
              that is not 40-hex; a serial chain's HEAD that is no commit, or the HEAD guard's refusal; and, as the
              read's, no `Project root:` or a serial note's `repo:` surface that is not exactly one git toplevel).
              128+n: stopped by signal n before verify started, nothing recorded. Exit 2:
              refused (no `completion_verifier:`, an unreadable value). Exit 3: another --run holds the attempt.
              Exit 4: the canary's arm (nothing run) or check (recorded `unrun`) exited non-zero, but for the
              check's own exit 4 (an acked trip: recorded `unrun`, exit 0), its stderr passed through and its exit
              in the line's canary_exit; the check's exit 9 (a lane hold, ADR 0046) reads as 3 does: `unrun`, its
              canary_exit 9.

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
              parallel rollout until signed or deferred; it no longer holds its Project root against serial chains
              while it waits (ADR 0060: unfinished-rollout.py's parallel_hold).

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
              --standing --rollout <note> (ADR 0034, ADR 0062): the standing approval, run by the lead
              unattended. It signs only the spend gates Lachy's recorded standing approval covers and the
              credential gates his declared test-credential class covers (below). Each pending spend bullet is
              priced by skills/_shared/scripts/gated_inputs.py's exposure() (fail closed: irreversible gates, a
              credential outside the class, and any shape it cannot price, never pass) against the limit
              `spend_approval_usd`, resolved task frontmatter -> rollout frontmatter -> rollouts.toml
              (_resolved_settings: file:repo, file:defaults) -> built-in 0, which is off (sources `task`,
              `rollout`, `file:repo`, `file:defaults`, `built-in`; _retry_budget's order), lazily: at a slug's
              first gate that is not a credential gate, or the first gate of a bounced note, so a slug of
              credential gates alone never reads it (a bad stamp errors only a slug that holds a spend,
              irreversible or bounced gate). A credential gate on a note the plan judge never bounced (ADR 0062)
              is covered iff gated_inputs.credential_reading() reads it as the repo's declared test credential
              (rollouts.toml's `test_credentials`, read through _resolved_settings once per call: a refused file
              is exit 1 for each slug that needs it, nothing written; no Project root, as on every serial note,
              or no repo table is no class, so it asks), the rollout's `env_bootstrap` copies the declared file
              with a plain cp (bootstrap_refreshes(); a value the frontmatter reader refuses asks with its
              words), and each key it names is in that file with its declared prefix or Supabase project
              (env_proof(); no value is ever printed or written). It is the class's own switch: no limit, no
              month line, no Needs-you log line, no spend lock. A gate already approved is proved again first,
              then not written again. Its annotation is gated_inputs.credential_annotation()'s `(approved <date>
              under the standing approval: test credential K1, K2 present in <file>, class from <source>)`, and
              its line prints `<slug>: gate approved under the standing approval: <gate> (test credential K1, K2
              present in <file>, <source>)`. A spend gate is covered iff
              the limit is > 0, its total exposure is at most the limit, and (p30-8, ADR 0034's 2026-10-27
              amendment: spend is never asked ahead) this calendar month's standing-approved spend with it stays
              within the same limit, the month line, inclusive. The month (local time, from --now) sums the
              `- <stamp> [[<slug>]] signed under the standing approval: US$<x> …` lines under `## Needs-you log`
              of the --rollout note and of every note directly in the tasks dir, Archive/ and Archive/Rollouts/
              whose name is a dated rollout note's (`-rollout-<YYYY-MM-DD>[-N].md`), each once by real path, plus
              the earlier gates and slugs this call signed; the mark must follow a line's first wikilink, so a
              push line never counts, and Lachy's bare sign-offs are never logged. It is read lazily, only for a
              gate that prices within the limit and is not already in `## Approved gates`, under a machine-wide
              lock (`standing-spend.lock` beside the note locks; never on --dry-run) held from that read to the
              call's last save; a lock not taken within THREAD_NOTE_LOCK_TIMEOUT is exit 1, and nothing written
              for any slug that needed the month read. A gate past the month line is an ASK whose why is `this
              month's (<YYYY-MM>) standing approvals would reach US$<m> with this gate, past the US$<t> month line
              (<source>)`; a note it cannot read (or a directory it cannot list) is an ASK whose why is `cannot
              read <path> for this month's standing approvals (<error>)`. For a slug with gates newly signed, the
              rollout note is written first: one `- <stamp> [[<slug>]] signed under the standing approval:
              US$<x> (month to date US$<m> of US$<t>, <source>): <gate>` line per gate, appended inside
              `## Needs-you log` (created at the note's end when absent); a failed log save is exit 1 for that
              slug, its task note untouched. Then the task note, as below: a task save that fails after the log
              save leaves the log line (over-count, fail closed). Each covered gate moves to
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
              3: some or none covered (the covered ones written, an ASK line for each of the rest, a credential's
              why the reading's, the bootstrap's or the proof's, e.g. `STRIPE_SECRET is not set in <file>`; a
              re-run on gates already judged writes nothing and exits 3); 1: an error, nothing written for that
              slug (a missing note, a task whose `rollout:` is not --rollout, a note that is not gate-pending with
              pending gates, a `spend_approval_usd` stamp that is not an integer >= 0 on a slug that resolves the
              limit, rollout settings refused, the standing-spend lock held past its timeout, a Needs-you log
              line that cannot be saved).
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

  lane-hold   The Lane hold's one write (ADR 0048, p29-7; Lane hold, below; execute § 4.5 *Lane hold*): `--rollout
              <note> --tasks <slug> --cause <cause> [--tasks-dir D] [--now] [--dry-run]`, the evidence on stdin (its
              first non-empty line, whitespace collapsed, `[[` written `[`, cut to 200 characters; `(no message)` when
              empty). It appends `- <stamp> lane hold [[<slug>]] <cause>: <evidence>` to the rollout's `## Lane log`
              (Note.append_line; a new section at the note's end), re-reads it, then frees the lane in the Run record
              (_halt_lane) when the record is unreadable or its lane is this task, and prints `<slug>: lane hold
              (<cause>) [written]; lane freed` (or `; the record holds no lane on it`), plus ` (task note unreadable:
              <why>)` when it could not read the task note. Exit 2: more than one slug, or a cause outside
              LANE_HOLD_CAUSES. Exit 1, nothing written: the rollout note unreadable; the task note readable but its
              `rollout:` another rollout's; the task note unreadable and the rollout's `## Queue` not linking the slug
              (`names no task of [[<ro>]]`, _queue_links); a failed save or a line missing on re-read. An unacked hold
              with the same slug and cause writes nothing (`[no-change]`; a lane the record still shows on the task is
              freed). It needs no task note, so a hold lands exactly when the note will not parse.

  lane-ack    Lachy's ack of a Lane hold (repair § 3g, its one writer): `--rollout <note> --tasks <slug>[,<slug>…]
              --fix "<his words>" [--now] [--dry-run]`. It appends `- <stamp> lane ack [[a]], [[b]]: <fix>` to the
              `## Lane log`. Exit 2: no slug, or an empty or multi-line --fix. Exit 1: the note unreadable, a slug no
              hold line names, or a failed save. Every slug already acked writes nothing (`[no-change]`). It reads no
              task note and writes no event.

  moving      The Watchdog's reading (ADR 0048, p29-7; status SKILL.md § The Watchdog's reading, which carries the
              safety wording's one copy): `--rollout <note> [--tasks-dir D] [--now ISO] [--stall-after MIN]
              [--gh-bin gh]`. One compact JSON line, {rollout, verdict, cause, reason, lastEvent, ageMinutes,
              stallAfter, until, work: {running, lane, start, halt, reentry, coolDown, capHeld}}, verdict moving |
              stalled | waiting (its cause the meant wait) | skip. Read-only and guard-exempt: no note, event, lock or
              claims file is written, and no bytecode. Exit 0 any verdict; 1 `ERROR: moving: <why> (a lost look, never
              a stall)` when the note, the Run record or `next` cannot be read (MovingError); 2 usage (--stall-after
              outside 1 to 1440; default STALL_AFTER_MIN 45, two missed 20-minute heartbeat ticks and some slack).
              moving_verdict is the body; watchdog.py calls it in-process. The algorithm's one copy, first match wins:
              1. skip: _ledger_skip (serial, superseded, done or dropped), or the note not directly in --tasks-dir
                 (archived).
              2. The Run record (_record_read, _record_state): either unreadable is a MovingError.
              3. Pauses: waiting `sign-off` when `paused_for: sign-off` (checked first: await-sign-off stamps `paused:`
                 with it); then waiting `paused` when _pause_stands (a stamped pause, his whole-rollout act, read as
                 `paused` even beside an unacked Lane hold: status's LANE HOLD headline carries that ack).
              4. A room stop under its bound (_room_stop_stands): waiting `room-stop`, `until` its stamp + 6 h.
              5. Never started (never_started) and no `lead-entry`: waiting `not-started`.
              6. `next --dry-run` in-process through _parser() (no --running: every in_progress note is live), its
                 stdout and stderr captured; exit 1 → waiting `you` (`next refused the rollout: <its ERROR line>`); an
                 exception → MovingError; halt superseded or done → skip.
              7. The whole holds `next` reads live (their reasons built from LIVE_WHOLE_REASONS' prefixes): a
                 `gitEnvHold` entry with scope rollout → waiting `you`, `git-env trip: the shared checkout changed`; a
                 non-empty `mainRed` → waiting `you`, `RACE: the revert of [[x]] did not land: <why>`.
              8. W, the work the lead could act on now: `running` and `start` (and `restart`); the lane (laneHold
                 empty, no open ("merge", task) hold in the record on an integrating task, and something integrating
                 or awaiting Integration; or a `race` entry with `revert: true` and no `git-env` or `lane` entry; or
                 the Run record's open lane (_record_state's `lane`) on a task whose `race` entry has `revert: false`:
                 the lead's RACE re-verify or its landing tail, which never halts on its own task, so judged by
                 silence; the third `noslot`'s `free-lane` closes it, and the RACE left to Lachy then reads `you`); halt
                 `complete` or `regenerate`; and `reentry`: each setAside entry at `run` or `integration`, not
                 race-held, with no task `holdUntil`, under no held rollout hold and no `pauseRequested`, read as step
                 1.2 reads it (k = _retry_budget's max_review_rounds, None when invalid; lead-integrate.py task_inputs
                 with that k and auto_retry_verdict). A null `humanFix` with a future `autoRetryAfter` goes to
                 `coolDown`; an `autoRevise` seeded revise is W only while `slotsInUse` plus the revises before it is
                 below `slotLimit`, else `capHeld` (cause `heat` at verify-slot's HEAT_HOLD or worse, `away-cap` while
                 Away, else `trickle`); any other null `humanFix` is W.
              9. Life signs: L, the last of _stop_state's `live` (every heartbeat tick's lead-entry and every verb the
                 lead runs); S, the silence, now minus the latest of L, kern.waketime and kern.boottime
                 (machine_times(since=now): pmset is never read). The silence test at a bound B: L None → stalled
                 `silent` (`no life sign in the Run record`); S > B → stalled `no life sign for <age>m`, cause
                 `mac-restart` when a boot came after L, `usage-limit` when a usage-limit stop is open, else `silent`.
              10. H, the open halt: the last stop_spans entry with cause `halt` and no end, its reason that span's own
                  `stopped` line's (stop_spans' `reason` and `index`).
              11. With W: H's reason matching WHOLE_HALT_RES (execute § 7's *Whole-rollout halts kept*) → waiting
                  `you`; any other H → stalled `halt` at once (`<H>: the halt holds more than it threatens`); `next`'s
                  `halt: regenerate` → waiting `regenerating` while S <= REGENERATE_STALL_MIN (120; `until` the base +
                  120), else the silence test at 120: regenerate is judged before the stall-after test and in its
                  place, whatever else is in W (a running task included), because the Approved-queue route runs as one
                  foreground turn with no life sign; then the silence test at stall-after; otherwise moving.
              12. With no W: (a) an open ("merge", task) hold on an integrating task, released only by the lead's own
                  tick, is judged by silence at stall-after, else waiting `merge-hold`; (b) the waits judged by their
                  own condition, in execute step 1.6's order: `cool-down` (`until` the earliest), `heat`, `away-cap`,
                  `trickle` (`next`'s hold prefixes, or capHeld), `last-start` (`until` the Morning), `approved-queue`
                  (onMerge `waits`), `pr-hold` (a held `waits: merge` holdUntil entry), and `paused` only when `next`
                  reports `halt: paused` (a drained soft pause: one behind a lane verdict never drains while the note
                  keeps `integrating:`, so it falls to (c) and its ack is never hidden); (c) otherwise waiting `you`,
                  with H's reason, else `next`'s verdict worded as execute § 7 words it.
              Which waits silence judges (SILENCE_JUDGED, bound to status's list by a contract test; moving_verdict
              returns each through by_silence, which refuses a cause the list leaves out): `merge-hold` and
              `regenerating`, and every reading with work; `room-stop` by its 6 h bound; the waits of 12(b) by their
              own condition; never `paused`, `sign-off`, `not-started` or `you`. A wait the verdict fails to name
              changes only `waiting`'s cause, never moving or stalled.

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
  mark-started      slot-taken {settings, start, carriedFrom?, cap}. settings: parallel_ceiling (the rollout note's,
                    _ceiling), max_review_rounds / max_iterations / max_plan_rounds (task fm, then rollout fm,
                    then rollout-settings.py once per process; ints >= 1 kept; max_iterations 1 for a
                    read-only task with no stamp), rung (a rung name). start, first match: --start resume;
                    a `handed_back:`, `gates_signed:` or `descope_armed:` marker -> hand-back; --start
                    revise|restart|start; `started:` present -> restart; else start. carriedFrom: the
                    record's unconsumed `carried` line for the task. cap (p29-8, ADR 0049): the Mac-wide cap
                    in force, {away, n, file} (_cap_in_force: n the Away cap while Away, else the Trickle),
                    the Away state file read once per run, silently (`next` prints its WARN). No resolvable
                    ceiling (or no rollout note): one `run_record: warning: slot-taken for <slug> not
                    recorded: <why>` line.
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
                    pr= when `ready:` is stamped; merged readOnly=true for a read-only approval. Those three,
                    and the set-aside, quota-stall and review-verdict lines of a row that ends a Slot, are the
                    call's end (p29-12): stamped at _call_end's end with `stamp: call-end` and `reconciledAt`
                    (this run's clock, when the lead released the Slot), or with none readable at this run's
                    clock with `stamp: fallback` (a ready or merged on a row that ends no Slot is a fallback
                    too); every other event (the lane's, the holds') is the lead's, at this run's clock,
                    unmarked. When it
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
                    (QUOTA_RE), with the task's latest run-bound's runId and call (p29-10; omitted when it has none);
                    then (p21-3) review-verdict {round, verdict, findings, original, regression,
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
                    done or empty (free stays the ceiling's, never the Trickle's, the Away cap's or the Heat
                    hold's); then the night record (p28-2, _night_record): away-night {morning} once per
                    (rollout, M) while the last starts apply, last-start-held {morning, scope, history,
                    usualMinutes?} once per (task, M) for each final `last start:` hold, and ran-past-morning
                    {morning, slotTakenAt, scope, history, usualMinutes?} once per (task, M) for each task whose
                    Slot the record shows open at a marked Morning at or before now; an unreadable record writes
                    none (one `run_record: warning: night record not written: <why>` line while the last starts
                    apply). Before idle-slots (p29-10, _record_sleeps): a sleep no entry follows, stopped {cause:
                    mac-sleep, inferred: true, at, wake, calls}, only while the record has a lead-entry, no pause
                    stands and no stop is open, and the Mac's last wake is later than the last lead-entry and the
                    latest recorded wake.
  clear-pause       when it removes `paused:`: paused mode=hard at the stamp when the record has no open pause
                    (a hard pause whose record-pause never ran), then resumed. Removing only
                    pause_requested records nothing; a refusal (STILL-AWAITING) records nothing.
  await-sign-off    paused mode=sign-off when it stamps, unless the record shows a pause open.
  completion-verify (--run) completion-verify {result, rc, sha, attempt, log, followup?}: one per recorded run, a
                    no-verdict one included (task null), after its log line.
  record-verify     (p29-9) flake {test, repo, sha, site, followup, count} per new Flake log line (_record_flakes);
                    suite-timeout {site, run, seconds, sha?} for a timeout. reconcile writes flake events too, from a
                    row's `flakes` (the row-field mapping below).
  record-entry      (p29-10) stopped {cause, inferred: true, at, calls, boot?, wake?} for each stop the entry finds, in
                    `at` order, then one lead-entry {by, session?, stop?}; nothing for a skipped note.
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
idle-slots reason, first match ("queued" is queued and not starting this call): a whole-rollout gitEnvHold entry (a
bare checkout; a lane trip holds no Slot) -> hold-git-env; mainRed (a RACE revert that did not land) -> hold-race;
paused or pauseRequested -> pause-drain; any `heat:` hold (the Heat hold; only ever a queued row) -> hold-heat; any
`trickle:` hold (only ever a queued row: a stalled row waits on the ceiling alone) -> hold-trickle, and any `away cap:`
hold (the same, Away) -> hold-away-cap; any `last start:` hold (p28-2: a queued row or a head Solo the last starts hold
toward the Morning) -> hold-last-start (after hold-away-cap, with which it can co-occur Away); the rollout's own
hold_until standing -> hold-pr; the first held queued row's reason: `hold until` (a task's own hold_until) -> hold-pr,
`depends on` -> dependency,
solo or behind solo -> solo; any task's own hold_until standing (a stalled row's, or a row's set aside at its run or a
gate) -> hold-pr; no queued row and a RACE in raceHold -> hold-race; no queued row and a set-aside
row -> awaiting-hand-back (a known mislabel when every one is a blocked row step 1.2 relaunches as a seeded
revise: its slot-taken start=revise splits the span seconds later; also while step 1.2's automatic retry waits out
a quota or infra cool-down, p16-4, since `next` never reads the retry verdict: the task's auto-retry event ends
that span); else queue-tail. `next` never records hold-merge: a merge hold is lead state, recorded by `hold`.
Departures from the p15-2 brief: no ceiling-changed (the writer refuses it; the settings on every slot-taken
and idle-slots carry the ceiling); log-integration records nothing (the lane is held through the merge, ADR
0030; its path and triggers ride on mark-done's lane-freed release=merge); merge-task.sh records no `merged` (its
positional args name neither rollout nor task, and `merged` has one writer per landing: the vault flip to
done); since p29-10 it records each newly counted exit-3 refusal's `base-moved`, through lead-integrate.py
`base-moved`, which finds the task by its PR.

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
halt verdict, while its lane hold (`laneHold`, below) says when the lane moves. `hand-back` refuses a held task (exit
2, nothing written). `status` reports the stored state, which status § 3 renders as a RACE itself.
The RACE revert (ADR 0046; execute § 4.5 *The RACE revert*): a RACE red after the Flake check is reverted on main
through a revert PR that merges only through merge-task (lead-integrate.py `revert`). Its only Race log lines are
`- <stamp> [[<slug>]] revert started: <M> …`, `revert opened: PR #R <url>`, `reverted on main: <sha> (revert PR #R of
PR #N's merge <M12>; …)` and `revert did not land: <why>` (_race_reverts reads them, the latest of each kind winning).
An undecided RACE holds the Integration lane only (`next`'s `laneHold`, never a start) until it is reverted with main's
tree restored (by tree, or but for proven Inert paths) and its tail done: a revert started, not failed, whose
`integrating:` still stands is pending (`revert: true`), and one reverted with `main not re-verified` keeps the lane
held (`revert: false`). A revert that did not land is `mainRed` (_main_red): main is red, so the whole rollout is held
until Lachy's `RACE decided:` line, whatever the task note's status. A note whose `pr:` the revert reverted
(_reverted_pr: a `reverted on main:` line naming its slug and `PR #N's merge` with its PR number) never re-enters:
`resume` leaves it (`[no-change]`), `hand-back` refuses it (exit 2) and the automatic retry names H7; a new `pr:` passes. A verb that moves a task because its decision lifted the hold (`resume`
lands it, `hand-back` or `auto-retry` re-enters it) records that once, `race-decided` (_record_decision, p21-2): the
human act a Reflection counts. The hold itself, opened on every merge-task exit 5 and ended by a green re-verify's
mark-done, is no act. `defer` and `mark-done` never read the decision.

Git-env hold (_git_env_hold, read by `next`, `status`, `carry` and skills/execute/scripts/git-env-canary.py;
execute § 4.5 *Git-env canary*): the rollout note's `## Git-env log` (GIT_ENV_LOG_SECTION) holds one line per
tripped window, `- <stamp> git-env trip [[<slug>]] <kind>: <what changed>; repo <R>` (GIT_ENV_TRIP_MARK), written
by the canary when the shared checkout's `refs/heads/<default>` or its bareness changed during a window, and one
line per human ack, `- <stamp> git-env ack [[a]], [[b]]: refs/heads/<B> at <sha|absent>, core.bare false`
(GIT_ENV_ACK_MARK), written only by the canary's `ack` (through /thread:repair). A Bookkeeping miss whose state check
passed is logged as `- <stamp> git-env miss [[<slug>]] <kind>: <reason>; <the checkout's state>; holds nothing; repo
<R>` (GIT_ENV_MISS_MARK) and holds nothing (ADR 0046). The hold is every trip line that no later ack line names (its
wikilinks, read with WIKILINK_OPEN_RE), in log order, as {slug, kind, line, scope}: `scope` is `rollout` when the line
reads a bare checkout (GIT_ENV_BARE_RE: `core.bare false→true`, `core.bare true at arm`, a failed state check's
`core.bare true`), else `lane`. While a `rollout` entry stands `next` starts and restarts nothing, holds every stalled
or queued task with the reason `git-env hold: /thread:repair` and reports `halt: "git-env"` ahead of every other
verdict; a `lane` entry holds only the Integration lane (`laneHold`), and `halt` is "git-env" once nothing else moves;
`status` reports it as `gitEnvHold`; and `carry` refuses the prior (exit 2, --dry-run included) with an ERROR line naming each held slug
and `/thread:repair [[<from>]]`. A `## Race log` line carrying `git-env halt` names its slug like any Race log line,
so once the hold is acked the RACE hold applies unchanged.

Lane hold (ADR 0048, p29-7; _lane_log_hold, read by `next`, `status`, `carry`, `lane-hold` and `lane-ack`, and by
`moving` through `next`; execute § 4.5 *Lane hold*): a cause that reaches every merge (merge-task's abort or its
environment exit 2, a lead-integrate.py exit 2 on the task holding the lane, the Integration verify's third `noslot`)
holds the Integration lane, never the whole rollout. The rollout note's `## Lane log` (LANE_LOG_SECTION, at the note's
end) holds one line per hold, `- <stamp> lane hold [[<slug>]] <cause>: <evidence>` (LANE_HOLD_RE, the cause one of
LANE_HOLD_CAUSES: merge-task-abort, merge-task-env, integrate-env, verify-noslot), written only by `lane-hold`, and one
line per ack, `- <stamp> lane ack [[a]], [[b]]: <his words>` (LANE_ACK_RE: its slugs are the wikilinks before its first
`]]: `), written only by `lane-ack` (through /thread:repair § 3g). The hold is every hold line no later ack names, in
log order; a hold after an ack holds again. While one stands, `next` lists a {slug, hold: "lane", cause, stamp} entry in
`laneHold` after the git-env and race entries: the lane does not move (a pending RACE revert included), task calls go
on, and `halt` is "lane" once nothing else moves, after "race" (lane) and before "paused". The held task's note keeps
`integrating:`, so a soft pause never drains past it. `status` reports the holds as `laneLog`; and `carry` refuses the
prior (exit 2, --dry-run included) with an ERROR line naming each held slug and `/thread:repair [[<from>]]`, since the
carry strips `integrating:` and never copies the `## Lane log`.

Trickle and Away (Chorus ADR 0104 d2, d6; ADR 0049, which overturns d3; the spec is skills/execute/away.md): `next`
reads the Away state file, ~/.config/thread/away.json under the home dir at call time (AWAY_FILE_REL), as one JSON
object of AWAY_KEYS, all required, and the optional AWAY_CAP_KEY (_away_state). Missing (no file, a dangling symlink, a
plain file in its directory's place), unreadable (any other OSError, over 64 KiB, not UTF-8, not JSON, not an object, a
key missing or ill-typed, an `away_cap` not above `trickle`) or stale (`until` <= now, `written_at` over 24 h old or
more than 5 minutes ahead) reads not Away at DEFAULT_TRICKLE with the Away cap at AWAY_CAP_DEFAULT, the file's own
`trickle` and `away_cap` ignored; stale and unreadable print the AWAY_WARN line. Fresh, `away` and `trickle` are the
file's, and the Away cap is its `away_cap`, else AWAY_CAP_DEFAULT lifted to `trickle` + 1 once the Trickle reaches it.
One Mac-wide cap applies, its value by Away state, the Trickle not Away and the Away cap Away, and each rollout's
ceiling still bounds its share: slotLimit = min(ceiling, max(0, cap - the count elsewhere - the places kept)), the
places kept those a fair share keeps for waiting rollouts (p28-5; Trickle claims, below). The count elsewhere is
one walk of --tasks-dir (off --dry-run a fresh one, _note_index, taken under the trickle claim lock below; under
--dry-run the call's own, _scan's index) plus every other lead's live Trickle claims. In the walk (_elsewhere_running)
each other rollout note directly in --tasks-dir, tagged `rollout`, not done or dropped, parallel, with no `paused:`
stamp and started (never_started), counts its `status: in_progress` notes less the ones its own undecided RACE or
UNVERIFIED holds. Serial rollouts, review and integrating notes never count. This rollout's own use is counted the same
way, every in_progress row of its own, live or stalled, so a new start fits only while elsewhere + the places kept + its
own in_progress + this call's starts < the cap; a restart waits on the ceiling alone (no state leaves two respawned
leads each waiting on the other's stalled notes). `status` and every progress line count notes only. Nothing here
writes the file; mark-started reads it too, for slot-taken's `cap` (Run record, above), `status` for its `trickle`
block, and every progress line (_progress_for, `next`, `status`) for the ETA's width (p28-6, _eta_width: the chunks
still ahead at min(ceiling, max(1, cap - the count elsewhere)), the Heat hold and the places kept aside); all of them
read it silently, and only `next` prints the WARN.

Trickle claims (p28-3; the spec is skills/execute/away.md § The Trickle, *Trickle claims*): two leads' `next` calls
would otherwise both see the room one place leaves between one lead's `next` and its § 4 stamp. So off --dry-run, once
the refusals pass and every PR-hold gh call is made, `next` takes the machine-wide trickle claim lock (TRICKLE_LOCK, in
the note-lock dir, _trickle_paths), walks --tasks-dir afresh, reads the claims file (TRICKLE_CLAIMS beside it,
_trickle_claims_read), counts each other lead's live claim it judges (_trickle_claims_judge) beside the notes, picks
its starts, saves the rollout note and, only once that save succeeds, writes the kept claims plus one per start of
its final `start` (the head Solo task's lone start included), replacing this rollout's earlier ones, then lets the lock
go. A claim counts until the note-based count counts its task (its § 4 stamp consumes it), or for TRICKLE_CLAIM_TTL
from its `at`; a missing or torn rollout or task note keeps it counting until then. --dry-run reads the claims and
takes no lock, re-walks nothing and writes nothing. A lock it cannot take, a file it cannot read or a write that fails
prints one TRICKLE_WARN line and fails open (the old window: one call's starts per lead), never a halt; a file of
another version is read as none and never written.

The fair share (p28-5; the spec is skills/execute/away.md § The Trickle, *A fair share*): a lead refills the Trickle
the moment one of its calls returns, while a lead waiting on it re-checks only at its heartbeat's ticks, so the claims
file also holds a `waiting` list beside `claims` (still version 1; an absent one reads [], one that is no list reads as
none, silently, and the next write replaces it). Off --dry-run, in the claims write, `next` records this rollout
waiting whenever its final holds include a row on `trickle:`, `away cap:` or `heat:` (so a hot spell keeps its place
in line), or a seeded revise execute § 4.5 step 1.2 launches (_seeded_revises: `inputs`' autoRevise, read as step 1.2
reads it) waits on slotLimit: one record {tasksDir, rollout, since, at, served, want} (TRICKLE_WAIT_KEYS), `since`
carried from its own earlier record, `served` the call's now once it starts, else the later of its own earlier
record's and its latest `started:` stamp (_latest_started: so a start whose call wrote no record, under a lock it
could not take, still counts), else null, and `want` its waiting rows, Solo-aware, plus the revises step 1.2 cannot
launch, capped at its ceiling's room. Its earlier record is always replaced, and a call with nothing waiting (a pause,
a hold, main red, a whole-rollout git-env hold, or everything started) removes it.
_trickle_waiting_judge reads the list in this order: malformed records dropped silently; another tasksDir's kept by the
wall clock and never counted; a record TRICKLE_WAIT_TTL old or older (or as far ahead) dropped, before the own record
is read, so a lapsed one never carries its `since`; repeats, the latest `at` winning; this rollout's own taken out;
one whose rollout note is present but outside the count dropped; one whose note is absent live until the TTL. Then,
with free places on the Mac (cap - the count elsewhere - its own in_progress) and no heat, _fair_share gives them out
one at a time among the live records and this rollout (its demand its startable rows plus its seeded revises, within
its ceiling, so a rollout whose only work is a revise still gets a place in line), each to the lowest (held, served,
since, stem), never served first, and slotLimit leaves out the places it keeps for the others (`trickle.kept`). A lock
not taken, or a write that fails, records no waiting record either.

A lead's lease (p28-4; execute away.md § The Trickle): the count reads notes, never sessions, so each live lead keeps a
lease, ~/.config/thread/leases/<rollout stem>.json under the home dir at call time (LEASE_DIR_REL), {rollout,
written_at, by}. `next` off --dry-run, once its refusals pass, and every record-entry rewrite it (_lease_write: a temp
file and os.replace; a failure prints one LEASE_WARN line and changes nothing else). A lease lapses 45 minutes after its
last write, or after the Mac's latest boot or wake if later (LEASE_LAPSE; _Leases, kern.boottime and kern.waketime read
lazily through machine_times), unless a room stop stands on the rollout note (_room_stop_stands, under
ROOM_STOP_BOUND). A rollout whose lease has lapsed leaves every count (_running_by_rollout: the count elsewhere,
mac_running, the ETA's width) and `next` names it under `trickle.lapsed`; `status`'s own `here` reads 0 then. Only
its notes leave: a live Trickle claim of its still counts (the `next` that wrote the claim renewed the lease first,
so a claim outlives a lease only when that lease write failed). No lease
file (an older engine snapshot writes none, ADR 0043) and an unreadable one (over LEASE_MAX_BYTES, not JSON, a
`written_at` missing, naive or more than 5 minutes ahead) still count.

The last starts and the night record (Chorus ADR 0104 d4 and its Consequences; the spec is skills/execute/away.md § The
last starts and § The night record): `next` reads M, the Morning (_morning_toward), only while a fresh file reads Away
with `until == M`: `until` read in local wall-clock time falls on `morning`'s HH:MM to the minute (M is that `until`,
its seconds cut: the same instant, at the local offset), and now < M <= now + LAST_START_HORIZON. So a Lunch restart, a
daytime Away block or one ending before or spanning the Morning holds and records nothing. Then a queued task's start,
and a head Solo task's lone start, each checked only once a Slot is found, is held (`last start: …`, LAST_START_PREFIX)
when now plus its kind's usual length is past M. Its kind is its note's `scope:` (_kind), its usual length the median of
the kind's past runs (_past_runs: this project's folded call journals over LAST_START_HISTORY, read lazily once per
call), and with fewer than LAST_START_MIN_RUNS runs the length is LAST_START_FALLBACK. A held row is skipped and the
greedy loop goes on; restarts, hand-backs and seeded revises are never held; the hold never halts; a git-env or pause
hold replaces it. Off --dry-run, _night_record writes the night record into the rollout's own Run record (NIGHT_KINDS),
each line once, read from the record's Slot intervals (_record_night), never from notes. A Slot reconcile closed
ends at its slot-freed's ts, its call's end (p29-12), so a call that ended before the Morning never reads as having
run past it because the lead reconciled it after.

Hold until (p30-3; _hold_until, read by `next`, `status` and `carry`; the grammar is skills/_shared/vault-grammar.md §
Hold until): a hold is frontmatter, never a sentence. A top-level `hold_until: {pr: <owner/repo>#<N>, merged: true}`
(or the block form, `hold_until:` then indented `pr:` and `merged:` lines) on a parallel rollout note holds every start
until that PR merges; on a task note it holds that task's new calls. `pr` is `owner/repo#N` (gh reads it as
`https://github.com/owner/repo/pull/N`), a PR URL, or a bare `N` / quoted `"#N"` read in the rollout's Project root;
`merged` defaults to true and reads no other value. An unknown or repeated key, an empty value, `null`, a missing pr or
a bare number with no Project root directory is unreadable: it holds, waits on Lachy and makes no gh call (fail closed).
`next` reads each hold's PR with `gh pr view <url|N> --json state,mergedAt,url` (_gh, 60 s, memoised per call): MERGED
releases it and, off --dry-run, removes its lines (Note.remove_block, a compare-and-swap replayed under the note lock,
so a hold rewritten meanwhile stays and reads `cleared: false`; each in a save of its own, the rollout's after its start
stamp's save, which still fails the call; a failed clear is one stderr `WARN: hold_until on <note>: not cleared: <err>`
and the hold still releases for this call); OPEN or a gh error holds and waits on the merge (the next call retries);
CLOSED holds and waits on Lachy. Its reasons, all quote-free and opening
HOLD_UNTIL_PREFIX: `hold until <pr> merges (<STATE>)`, `hold until <pr> merges (gh: <its line>)` and `hold until:
hold_until unreadable (<why>)`. `status` reports each parsed hold, never its state. `carry` copies the prior's into the
note that supersedes it. A serial note's `hold_until` is read by nothing: `next` refuses the note first. The clear has
one exception, an approved queue's (below): its verdict keeps a merged hold standing while it waits or regenerates.

Approved queue (p30-4; the grammar is skills/_shared/vault-grammar.md § Approved queue): `on_merge: regenerate`
(ON_MERGE_KEY, ON_MERGE_REGENERATE; read as `_scalar(...).lower()` by _on_merge) beside a rollout hold_until on a
parallel note (_approved_queue). Its writer is `approve-queue`. Once the hold reads MERGED with no error, `next`'s verdict
(_on_merge_verdict), the first that applies: a done or dropped note releases plainly; an unreadable value fails closed
(held, `waits: you`, error ON_MERGE_BAD); _approved_marks (the queue's own read of what has run: never_started's marks
with the Chorus Stage's room-stop lines, ROOM_STOP_LINE_RE, read as no run mark) reading `run` releases it as a plain hold
with a `WARN: on_merge:` line; a room stop that stands holds it (`waits: room-stop`); an `integrating:` stamp whose task
is in flight (integrating, or a RACE-held lane) holds it (`waits: integration`), one with no Integration in flight reads
as run; with no linked member left after the project filter (_approved_members) it releases with a WARN; otherwise it
holds (`waits: regenerate`) and `halt` is "regenerate" (once no git-env trip, `mainRed` or `laneHold` entry stands: each
halts first, ADR 0046), with the members: this note's unlanded rows, a never-started
successor's (an interrupted chain's), and the open siblings in their phases (schedule step 1's skip rule), each carrying
the note's first project (_norm_project). While it holds nothing starts, restarts or newly integrates
(`awaitingIntegration` is []), and the hold is never cleared. A plain release (the verdict's `released`, or a done or
dropped note) clears the hold and its `on_merge:` lines in one compare-and-swap (Note.remove_block's `also`), so a hold
added by hand later is a plain hold. `carry` never copies `on_merge`.


Heat hold (estate ADR 0009 d5; the spec is skills/execute/away.md § Heat): `next` reads the Mac's thermal pressure once
per call, right after the Away state (so a refused call reads neither), through verify-slot.py's heat_level()
(_heat_module, _heat_state: THREAD_HEAT_LEVEL pins it; a module that will not load, as on Windows, or a failed reading
reads 0, fail open). At heavy (2) or worse `slotLimit` is 0, Away included, so nothing new starts; a restart still waits
on the ceiling alone. A row held for want of a Slot then reads `heat: the Mac is hot (<name>)` (HEAT_PREFIX) unless the
ceiling is full (`ceiling:` first); no Slot is found, so the last starts never read it; a whole-rollout (bare) git-env
hold or a main-red hold (cmd_next's `whole` / `main_red` override), a pause and a standing rollout hold_until hold their
rows themselves, while a lane-only git-env trip holds no Slot, so the heat reads its rows as usual. A `heat:` hold
never halts.

Never started (never_started, read by `carry`, `stamp-start`, status's chainStart and, through approved_unrun,
skills/_shared/scripts/unfinished-rollout.py): no execute
session has run the rollout. Only execute's own marks count. On the rollout note: `paused:`, a truthy
`pause_requested`, `completed:`, or a `## Pause log`, `## Completion log` or `## Leg log` (a serial rollout's Legs,
leg.py) heading line. On a linked task note:
a non-empty `owner:` or `integrating:`. A task's status and its `started:` / `ready:` / `merged:` stamps never
count, because a carry keeps them. A protocol-3 run shows through the `owner:` its engine stamped on each task
at dispatch. approved_unrun is the approved queue's widening (Approved queue above): an approved queue whose only marks
are the Chorus Stage's room stops, each one ended, reads as never started to `carry` (--from), `approve-queue` and
unfinished-rollout.py; never_started itself is unchanged, and every other reader keeps it.

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
                    own (or seeded revise) call returned, per the engine header, so the stamp is that
                    call's end (p29-12, _call_end), else now. A set-aside re-entry is leaving Integration,
                    not joining the queue. A re-reconcile (review -> review) never re-stamps;
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
                    "## Integration log", exactly 11 space-separated tokens:
                      <startedAt> <outcome> path=<p> pr=<n> anchor=<sha> head=<sha> base=<sha> wait=<n|->
                      duration=<n|-> triggers=<list|-> active=<n|->
                    from metrics.startedAt (verbatim), outcome, path, the row's prUrl (its PR number; `pr=-`
                    when missing, empty or neither a GitHub PR URL nor `#7`/`7`), anchor.headSha, headSha,
                    baseSha (full SHAs), metrics.waitMinutes / durationMinutes (ints) and triggers
                    (comma-joined, in order). `-` stands for a missing value (None, '', [], a non-int minute
                    count); whitespace inside a value becomes `_`. duration is the Integration's wall time;
                    active (p29-13) its active time, the wall less the stalls inside the window from startedAt
                    to metrics.finishedAt (startedAt + duration when finishedAt gives other minutes): the
                    union of the rollout's Run-record stops whose calls stop with them (stop_spans: a usage
                    limit, a dead lead, a Mac restart or sleep, a Watchdog recovery; a halt carries the calls
                    on, so it is none), the Mac's sleeps the record does not hold yet (_unrecorded_sleeps:
                    `next` writes a sleep only after the lead has reconciled the call, and an agent's
                    durationMs holds the sleep, so this line reads them from the Mac itself, without writing)
                    and, where no stop is logged inside it, the integrate call's journal gaps (each span of 30
                    minutes or more no live agent of the call ran in, JOURNAL_GAP_MS). A resumed call's
                    journal replays each agent that finished before the kill as a `cached: true` entry
                    stamped at the resume with no durationMs: it places no time in this run, so it is skipped,
                    and the gap before the first live agent holds the earlier run's work by the replayed
                    agents as well as the stall and the attempts it killed (an overcount of the stall, never
                    a stall counted as lane work). `-` with no startedAt or duration, when the Run record
                    cannot be read (no `rollout:` on the note, an unreadable file), or when the journal it
                    falls back to places no live agent at all (every one replayed: the stall cannot be
                    placed, and active = wall would read as a stall-free Integration). It is appended last,
                    so a line from before p29-13 (ten tokens, no active) still parses, and every reader reads
                    tokens by key; log_minutes() is the lane-time readers' one parse (its lane: active, else
                    the wall). Dedupe: a line whose
                    startedAt is set is skipped if an identical line appears anywhere in the section; a line
                    whose startedAt is `-` is skipped only if it equals the section's last non-blank line;
                    both compare lines without their active= (_log_identity), the one value a later stop can
                    move. So a re-reconcile is byte-identical, and with startedAt so is a replay of an older row (two Integrations of
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

  flakes         -> (any status; p29-9, ADR 0050) the Flakes this call's agents reported: [{test, sha}], a task call's
                    (site task: its implementers' and revisers' verifier loops) or an integrator's (site integrate:
                    a row with `integration`). Each well-formed entry (_flake_entry: test a one-line string of at most
                    300 characters, sha 7-40 hex) is logged by _record_flakes: one `## Flake log` line keyed (task,
                    sha12, site) on its follow-up, `<project>-followup-flake-<h>` (h the first 10 hex of the sha256
                    of the repo and the test, a newline between; the repo the Project root's origin owner/name, else
                    its basename, else the project slug), found by a glob of the Tasks root for one not done, merged or
                    dropped, else filed
                    fresh (exclusive create: one created meanwhile is appended to), a finished or archived one getting
                    a `-2`, `-3`; from its second line the follow-up reads `priority: high` with a `## The repo's to
                    fix` section; and one `flake` event per new line. A line already there writes nothing, so a
                    re-reconcile or a replayed row is a no-op. One `flake:` line per entry follows the row's line. A
                    malformed entry is a WARNING, skipped; `flakes` that is not a list is an ERROR (exit 1) and records
                    none; absent or null records nothing (a lead-written row, a pre-p29-9 engine's). An integrate row
                    reconciled with --no-verdict records none (a git-env trip inside its window voids its runs, Flakes
                    included): one `<slug>: N Flake(s) not recorded: --no-verdict …` line instead. Nothing on
                    --dry-run but the lines.

Accumulated feedback (p6-4): the run sections keep every run, never only the first. Each run is a block

  ### Run <n> (<stamp>)

  <content>

  <!-- run <n> end sha=<12 hex> -->

where sha is the sha256 of the normalised content (lines right-stripped, outer blank lines dropped, runs
of blank lines collapsed). The content is written neutralised: a heading at level 1-3 in it is pushed
three levels down and a run-end-shaped line is indented, so feedback text can never end its section or
open or close a run (the sha stays over the content as given). See Note.append_run for the rules; nothing
already written is ever deleted.

The Engine snapshot guard (ADR 0043; skills/_shared/engine-snapshot.md). Every verb but `status`, `fold-journals` and
`moving` first asks engine-snapshot.py, loaded from this tree, about each rollout the call acts on: guard() on the note its
--rollout (carry: its --from) names (lane-hold and lane-ack require it), and guard_task() on each --tasks slug's note
and, for `reconcile`, each result row's task note (the rollout its `rollout:` names), so a task-keyed verb run with
--rollout left off (hand-back, mark-started, mark-integrating, mark-done, log-integration, bind-run, free-lane, hold,
defer, approve-gates, reconcile) is guarded too. When one names another usable snapshot than this plugin root, or a live
note's snapshot is unusable, it prints the guard's `engine-snapshot: ` line on stderr, writes nothing and exits 2. Re-run the same
command from the root the line names. An unstamped note, an archived one whose snapshot is gone, and a task note
that names no rollout (or one not found), pass from any root. The three exemptions run from any root: `status` writes
nothing (/thread:status and the estate scan read every rollout with it), `moving` writes nothing either and is the
Watchdog's reading of any rollout from any root, and `fold-journals` never reads the note
and writes only call-journal lines to the Run record, cross-version state (engine-snapshot.md § Cross-version
state) that reflect folds across rollouts from its own root.
"""

import argparse
import contextlib
import fnmatch
import hashlib
import importlib.util
import io
import json
import math
import os
import re
import shlex
import signal
import shutil
import stat
import statistics
import subprocess
import sys
import time
import types
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

try:
    import fcntl
except ImportError:   # Windows: completion-verify --run refuses there; every other verb runs (run_record.py's guard)
    fcntl = None

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
# The standing approval's month line (p30-8, ADR 0034's 2026-10-27 amendment): approve-gates --standing logs each gate it
# signs in the rollout note's `## Needs-you log` as `- <stamp> [[<slug>]] signed under the standing approval: US$<x> …`,
# and sums this calendar month's such lines across every rollout note (ROLLOUT_NOTE_NAME_RE's dated names in the tasks
# dir, Archive/ and Archive/Rollouts/, plus --rollout) under the machine-wide STANDING_SPEND_LOCK. The mark must follow
# the line's first wikilink directly, so a push line that quotes it never counts.
NEEDS_YOU_LOG_SECTION = "## Needs-you log"
STANDING_SPEND_MARK = "signed under the standing approval:"
STANDING_SPEND_RE = re.compile(
    r"^- (\d{4}-\d{2})-\d{2}T\S+ \[\[[^\]]+\]\] signed under the standing approval: US\$(\d+(?:\.\d+)?)(?:\s|$)")
ROLLOUT_NOTE_NAME_RE = re.compile(r"-rollout-\d{4}-\d\d-\d\d(?:-\d+)?\.md\Z")
STANDING_SPEND_LOCK = "standing-spend.lock"
PAUSED_FOR_KEY = "paused_for"
SIGN_OFF = "sign-off"
PAUSE_LOG_SECTION = "## Pause log"
# The rollout start stamp (p23-6; skills/_shared/vault-grammar.md § Rollout start stamp): the execute handoff's
# Start when ready writes a top-level `start: unattended`, the Chorus Stage reads it (the first `start:` line, scalar
# lower-cased) and starts one lead once the note is runnable, and `next` reports it and, past its refusals and off
# --dry-run, removes it, so the Stage never starts a second lead. Chorus's record, `started_unattended:`, is untouched.
START_KEY = "start"
START_UNATTENDED = "unattended"
# The PR hold (p30-3; skills/_shared/vault-grammar.md § Hold until): a top-level `hold_until: {pr: <owner/repo>#<N>,
# merged: true}` on a parallel rollout note holds every start until that PR merges, one on a task note holds that task's
# new calls; `next` reads the PR through gh and, off --dry-run, removes a merged one. Every reason it gives opens with
# HOLD_UNTIL_PREFIX and is quote-free, so it can ride a ROLLOUT-STATUS reason=.
HOLD_KEY = "hold_until"
HOLD_UNTIL_PREFIX = "hold until"
HOLD_FIELDS = ("pr", "merged")
HOLD_GH_TIMEOUT = 60   # seconds for each gh pr view `next` makes: one per held PR per call, memoised
# The approved queue (p30-4; skills/_shared/vault-grammar.md § Approved queue): `on_merge: regenerate` beside a
# rollout-scope hold_until on a parallel note nothing has run turns the gating PR's merge into `next`'s `regenerate`
# verdict (execute's route runs schedule --regenerate and stamps the new note's start), read as `_scalar(...).lower()`.
ON_MERGE_KEY = "on_merge"
ON_MERGE_REGENERATE = "regenerate"
ON_MERGE_BAD = "on_merge must be regenerate"
# The Chorus Stage's room-stop lines under `## Pause log` (execute § Room stop), the one source of the pattern:
# step-boundary.py's ROOM_LINE is this object (it loads this module; this module cannot load it), and _approved_marks
# reads the same lines as no run mark on an approved queue.
ROOM_STOP_LINE_RE = re.compile(r"^- (\S+) room stop(: | ended\b)")
# A room stop's start line stands under this bound (step-boundary.py's `stands` default, whose BOUND_HOURS is read from
# here; the Stage's horizon for an owed resume, Chorus's OWED_MAX_S, 21600 s), and while it stands a lead's lease never
# lapses (p28-4, _Leases) and `moving` reads a meant wait (p29-7). _room_standing is the rule's one copy.
ROOM_STOP_BOUND = timedelta(hours=6)

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

def _drop_comment(raw):
    """A frontmatter value without its ` # comment`. A value that is only a comment (`# x`, or a lone `#`) becomes '';
    a bare `#7` stays a value (a `pr:` the code builds a PR URL from)."""
    return re.sub(r"\s+#.*$|^#(\s.*)?$", "", raw)


def _scalar(value) -> str:
    """A frontmatter scalar: inline ` # comment` dropped, quotes and whitespace stripped ('' for None). A value that is
    only a comment is '' (YAML's null): Note.get has already stripped the space before it."""
    if value is None:
        return ""
    s = _drop_comment(str(value)).strip()
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
    return note.filter_fm(_not_start_unattended)


START_LINE_RE = re.compile(rf"^{re.escape(START_KEY)}:\s*(.*)$")


def _not_start_unattended(line) -> bool:
    m = START_LINE_RE.match(line)
    return not (m and _scalar(m.group(1)).lower() == START_UNATTENDED)


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
    3.9's fromisoformat refuses it); naive values are assumed local time. A naive value that cannot be placed in
    local time (0001-01-01T00:00:00: its astimezone() raises ValueError, OverflowError or OSError, by zone and
    platform) reads None like any other unparseable stamp, so one hand-typed or seeded stamp never crashes a caller
    (p28-3: a Trickle claim's `at`, which `next` reads before any write could prune it)."""
    s = _scalar(value)
    if not s:
        return None
    if s[-1] in "Zz":
        s = s[:-1] + "+00:00"
    try:
        ts = datetime.fromisoformat(s)
        return ts if ts.tzinfo else ts.astimezone()
    except (ValueError, OverflowError, OSError):
        return None


def _room_standing(last, now, bound=ROOM_STOP_BOUND):
    """The room-stop rule's one copy (p29-7), on a _last_room_stop result: 0 under the bound, 4 at or past it (or an
    unparseable stamp), 5 with no start line last (step-boundary.py stands' exits). _room_stop_stands, step-boundary.py
    (begin, end, stands) and `moving` (through _room_stop_stands) read it."""
    if last is None or last[1] == "ended":
        return 5
    ts = _parse_ts(last[0])
    if ts is None or now - ts >= bound:
        return 4
    return 0


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

NOTE_LOCK_TIMEOUT = 30.0


def _note_lock_dir() -> Path:
    """Where the note save locks (and the standing approval's spend lock) live: THREAD_NOTE_LOCK_DIR, else
    XDG_STATE_HOME/thread/note-locks, else ~/.local/state/thread/note-locks; outside the vault so they never sync. It
    also holds `next`'s trickle claim lock and Trickle claims file (TRICKLE_LOCK, TRICKLE_CLAIMS; _trickle_paths)."""
    absolute = lambda v: v if v and os.path.isabs(v) else None   # noqa: E731  a relative dir is ignored (the XDG rule)
    base = absolute(os.environ.get("THREAD_NOTE_LOCK_DIR")) or os.path.join(
        absolute(os.environ.get("XDG_STATE_HOME")) or os.path.join(os.path.expanduser("~"), ".local", "state"),
        "thread", "note-locks")
    return Path(base)


def _note_lock_path(path) -> Path:
    """The note's save lock: one file per directory of notes (its real path's hash), shared by every note in it so
    the lock files stay few, and outside the vault so it never syncs. A save holds it for milliseconds."""
    real = os.path.dirname(os.path.realpath(str(path)))
    return _note_lock_dir() / f"{hashlib.sha256(real.encode()).hexdigest()[:16]}-{os.path.basename(real)[:60]}.lock"


def _spend_lock_path() -> Path:
    """The standing approval's machine-wide spend lock (STANDING_SPEND_LOCK, beside the note locks): approve-gates
    --standing holds it from its month read to its last save, so two calls never both sign against one month sum."""
    return _note_lock_dir() / STANDING_SPEND_LOCK


def _journaled(method):
    """A Note edit that save() can re-apply to a fresh read: only the outermost call is recorded, so an edit built on
    another (upsert_section on append_section) is replayed once, and only when it changed the note, so a no-op on a
    stale read (a remove of a key that was absent) never undoes another writer's fresh write."""
    def wrapper(self, *args, **kwargs):
        outer = self._depth == 0
        before = (list(self._fm), self._body) if outer else None
        self._depth += 1
        try:
            return method(self, *args, **kwargs)
        finally:
            self._depth -= 1
            if outer and (self._fm, self._body) != before:
                self._ops.append((method, args, kwargs))
    wrapper.__name__, wrapper.__doc__ = method.__name__, method.__doc__
    return wrapper


class Note:
    """A markdown note split into (frontmatter lines, body text), edited in place. Every edit is journaled, and save()
    re-applies the journal to the note as it reads under the note's lock, so writers in other processes (the canary,
    a reconcile verb, completion-verify --run) never lose each other's lines. A hand edit made through no script
    (the lead's Edit tool, Obsidian) takes no lock."""

    def __init__(self, path: Path, text=None):
        self.path = path
        text = path.read_text() if text is None else text
        self._text = text      # what this Note read, or last wrote: save() replays only when the file differs
        self._ops = []
        self._depth = 0
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
            value = _drop_comment(mm.group(1)).strip()
            if value:
                return _list_items(value)
            out = []
            for item in self._fm[i + 1:]:
                mi = re.match(r"^\s*-\s*(.*)$", item)
                if mi:
                    out.extend(_list_items(_drop_comment(mi.group(1)).strip()))   # `- # x`: no item
                elif item.strip():
                    break
            return out
        return []

    @_journaled
    def unset(self, key: str):
        """Remove `key:` from the frontmatter entirely. Idempotent; used to retire a marker that a
        later, better-informed run has superseded (a stale marker is triaged against, so leaving one
        is worse than never writing it)."""
        pat = re.compile(rf"^{re.escape(key)}:\s*")
        self.filter_fm(lambda line: not pat.match(line))

    @_journaled
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

    @_journaled
    def remove(self, key: str):
        """Delete the `key:` line from frontmatter entirely (idempotent — no-op if absent)."""
        pat = re.compile(rf"^{re.escape(key)}:\s*")
        self.filter_fm(lambda line: not pat.match(line))

    def _fm_span(self, key: str):
        """(i, j): the first top-level `key:` frontmatter line, i, through the indented, non-blank lines right after
        it (a block mapping's or a continued value's), ending before j; None when the key is absent."""
        pat = re.compile(rf"^{re.escape(key)}:")
        for i, line in enumerate(self._fm):
            if pat.match(line):
                j = i + 1
                while j < len(self._fm) and self._fm[j][:1] in (" ", "\t") and self._fm[j].strip():
                    j += 1
                return i, j
        return None

    def fm_block(self, key: str):
        """The `key:` block's lines (_fm_span) as a list, or None when the key is absent."""
        span = self._fm_span(key)
        return None if span is None else self._fm[span[0]:span[1]]

    @_journaled
    def remove_block(self, key: str, expected, also=()):
        """Remove the `key:` block (fm_block) only while it still equals `expected`, the lines a caller read: a
        compare-and-swap, so save()'s replay on a fresh read keeps a block another writer rewrote meanwhile. Each
        (key, lines) pair in `also` goes in the same swap, only once the first block went and only while it too still
        reads as read: a block kept by the swap keeps its companions."""
        span = self._fm_span(key)
        if span is None or self._fm[span[0]:span[1]] != list(expected):
            return
        del self._fm[span[0]:span[1]]
        for k, lines in also:
            s = self._fm_span(k)
            if s is not None and self._fm[s[0]:s[1]] == list(lines):
                del self._fm[s[0]:s[1]]
        self.dirty = True

    @_journaled
    def insert_block(self, key: str, lines, after=("status",), after_span=False):
        """Insert `lines` (a `key:` block, verbatim) after the first present anchor key, else at the end, only while
        the note has no top-level `key:` line, so a replay on a fresh read never writes a second one. With
        `after_span`, after the anchor's whole block (_fm_span: its indented lines too), so a block-form anchor such as
        `hold_until:` keeps its lines together."""
        if self.fm_block(key) is not None:
            return
        for anchor in after:
            apat = re.compile(rf"^{re.escape(anchor)}:")
            for i, line in enumerate(self._fm):
                if apat.match(line):
                    at = self._fm_span(anchor)[1] if after_span else i + 1
                    self._fm[at:at] = list(lines)
                    self.dirty = True
                    return
        self._fm.extend(lines)
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

    @_journaled
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
        if self._depth == 0:
            # Only a journaled edit may change the body, so save() can re-apply it; a direct call fails here, every
            # time, never only under a concurrent write. Use Note.apply for an edit of your own.
            raise RuntimeError("Note._set_body_lines outside a journaled edit: wrap the edit in Note.apply")
        new_body = "\n".join(lines)
        if new_body != self._body:
            self._body = new_body
            self.dirty = True

    @_journaled
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

    @_journaled
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

    @_journaled
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

    @_journaled
    def append_line(self, heading: str, line: str):
        """Record one bare line under `heading` (the Integration log), creating the section when absent.

        Dedupe, keyed on the line's first token (its startedAt): a line whose startedAt is set is skipped
        when an identical line (right-stripped) appears ANYWHERE in the section, so a re-reconcile and a
        replay of an older row are both no-ops; a line whose startedAt is `-` is skipped only when it
        equals the section's LAST non-blank line, so S, I, S' keeps three lines and the latest stays
        truthful (back-to-back identical `-` lines collapse). Under `## Integration log`, lines are compared
        by _log_identity (without their `active=`, p29-13), so a later stop the Run record learns of never
        writes the same Integration twice. Otherwise the line goes right after the
        section's last non-blank line, keeping one blank line after the heading and before any following
        `## ` section. Nothing already written is deleted or rewritten."""
        found = self._section_bounds(heading)
        if found is None:
            self.append_section(heading, line)
            return
        lines, start, end = found
        filled = [i for i in range(start + 1, end) if lines[i].strip()]
        same = _log_identity if heading == INTEGRATION_LOG_SECTION else (lambda x: x)
        kept = [same(lines[i].rstrip()) for i in filled]
        if line.split(" ", 1)[0] != "-":
            if same(line) in kept:
                return
        elif kept and kept[-1] == same(line):
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

    @_journaled
    def apply(self, fn, *args):
        """`fn(self, *args)`, journaled: for an edit computed from the note itself (a log line placed after the
        section's last line), so save() re-applies it to a fresh read. Returns fn's result."""
        return fn(self, *args)

    @_journaled
    def filter_fm(self, keep):
        """Keep only the frontmatter lines `keep(line)` is true for. True when one went."""
        kept = [line for line in self._fm if keep(line)]
        if len(kept) == len(self._fm):
            return False
        self._fm = kept
        self.dirty = True
        return True

    def _replay(self, ops):
        """Re-apply another Note's journal here, as journaled edits (inside the journal's depth)."""
        self._depth += 1
        try:
            for method, args, kwargs in ops:
                method(self, *args, **kwargs)
        finally:
            self._depth -= 1

    def save(self, dry_run=False):
        """Under the note's lock: read the note again, re-apply this Note's edits when another writer changed it
        since, and rename a temp file over it (_replace_keeping_metadata), so no reader ever sees it torn and a kill
        never truncates it, while it keeps its created time and Finder tags. A note
        gone from its path (moved or deleted meanwhile) is never written back: FileNotFoundError. A lock not taken
        within THREAD_NOTE_LOCK_TIMEOUT seconds (30) is an OSError, nothing written."""
        text = self.render()
        if dry_run or not self.dirty or text == self._text:
            return   # nothing since the read or the last save
        target = Path(os.path.realpath(self.path))   # a symlinked note: its target takes the save, the link stays
        with _note_lock(target):
            now = target.read_text()
            if now != self._text:
                # An edit outside the journal (a direct _set_body_lines) cannot be re-applied: refuse rather than
                # drop it. The journal replayed on what this Note read must give what it holds.
                base = Note(self.path, self._text)
                base._replay(self._ops)
                if base.render() != text:
                    raise OSError(f"{self.path} changed since it was read, and an edit here cannot be re-applied to "
                                  "it; nothing written: run it again")
                fresh = Note(self.path, now)
                fresh._replay(self._ops)
                self._fm, self._body = fresh._fm, fresh._body
                text = self.render()
            if not os.access(target, os.W_OK):
                # A rename would replace a read-only note anyway: refuse it as write_text did.
                raise PermissionError(13, "Permission denied", str(self.path))
            _replace_keeping_metadata(target, text)
        self._text, self._ops = text, []


def _replace_keeping_metadata(target, text):
    """Write `text` to a temp file beside `target` and rename it over `target`, so no reader sees a torn note and a
    kill never truncates it. The note keeps its metadata (Lachy's ruling: Obsidian sorts by created time): on macOS
    the temp file starts as a `cp -p` clone (mode, flags, ACLs and extended attributes such as Finder tags), and the
    note's created time is carried over (macOS sets a file's created time back when its mtime is set before it)."""
    tmp = target.with_name(f".{target.name}.{os.getpid()}.tmp")
    try:
        st = os.stat(target)
        if sys.platform == "darwin":
            subprocess.run(["/bin/cp", "-p", str(target), str(tmp)], capture_output=True)   # best-effort
            if tmp.exists():
                os.chmod(tmp, 0o600)
        with open(tmp, "w") as f:   # into the clone (its attributes kept), else a new file
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, stat.S_IMODE(st.st_mode))
        birth = getattr(st, "st_birthtime", None)
        if birth is not None:
            os.utime(tmp, (st.st_atime, birth))
            now = time.time()
            os.utime(tmp, (now, now))
        os.replace(tmp, target)
    finally:
        tmp.unlink(missing_ok=True)


class _note_lock:
    """The note's save lock (_note_lock_path), held only for a save's read and write, never across a child process
    (the `cp -p` clone aside, which takes no lock); the canary takes it inside its own lock, and nothing takes the
    canary's inside this one. With lock_path (and a label) it is another lock of the same kind: approve-gates
    --standing takes note locks (Note.save) inside the standing-spend lock (_spend_lock_path), and nothing takes the
    spend lock inside a note lock or the canary's. The trickle claim lock (TRICKLE_LOCK, p28-3) is outermost too: only
    `next` takes it, and takes note locks (Note.save) and the Run record's flock inside it, never it inside another
    lock. No fcntl (Windows): no lock, the atomic replace alone."""

    def __init__(self, path=None, lock_path=None, label="note lock"):
        self.lock_path = Path(lock_path) if lock_path is not None else _note_lock_path(path)
        self.label, self.fh = label, None

    def __enter__(self):
        if fcntl is None:
            return self
        try:
            timeout = float(os.environ.get("THREAD_NOTE_LOCK_TIMEOUT") or NOTE_LOCK_TIMEOUT)
        except ValueError:
            timeout = NOTE_LOCK_TIMEOUT
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        self.fh = open(self.lock_path, "a")
        deadline = time.monotonic() + timeout
        while True:
            try:
                fcntl.flock(self.fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return self
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    self.fh.close()
                    raise OSError(f"timed out after {timeout:g}s waiting for the {self.label} {self.lock_path}")
                time.sleep(0.05)
            except OSError as e:
                self.fh.close()
                raise OSError(f"cannot lock the {self.label} {self.lock_path}: {e}")

    def __exit__(self, *exc):
        if self.fh is not None:
            self.fh.close()   # closing the file drops the flock
        return False


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
    comma-joined in order; whitespace inside becomes `_`, so a line always has exactly 11 tokens. This
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


def _integration_log_line(task, active=None) -> str:
    """The `## Integration log` line for a row carrying a dict `integration` (the engine's
    integrationResult): `<startedAt> <outcome> path=<p> pr=<n> anchor=<sha> head=<sha> base=<sha>
    wait=<n|-> duration=<n|-> triggers=<list|-> active=<n|->`. startedAt is written verbatim when it is an
    ISO stamp (else `-`, see _log_started), SHAs in full. duration is the Integration's wall time; active
    (p29-13) the caller's _active_minutes, the wall less the stalls inside it, appended last so the ten
    tokens before it keep their places and a line from before it (ten tokens) still reads. The line carries no
    `now`, so a re-reconcile at another time writes the same line; the one value the Run record can still move
    after the fact is active, which append_line's dedupe ignores (_log_identity)."""
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
        ACTIVE_TOKEN + _log_field(active, minutes=True),
    ])


ACTIVE_TOKEN = "active="   # an Integration log line's last token (p29-13): the wall less the stalls inside it


def _log_identity(line) -> str:
    """An Integration log line with its `active=` token dropped: the line as append_line's dedupe compares it. active
    is the one value read from the Run record, which a stop inferred after the reconcile can still move, so the same
    Integration re-reconciled later (or a replay of a row whose line predates p29-13) is still the same line."""
    return " ".join(t for t in line.split(" ") if not t.startswith(ACTIVE_TOKEN))


def log_minutes(line) -> dict:
    """An Integration log line's minutes, for every reader of Integration (lane) time (p29-13): {wall, active, lane},
    each a whole number of minutes or None. wall is `duration=`, the Integration's wall time; active its `active=`, the
    wall less the stalls inside it (_active_minutes); lane the active figure, else the wall: a
    line from before p29-13 carries no `active=` and still reads, its wall (which can hold a stall) standing in. A
    `-`, or anything but digits, reads None."""
    t = _log_tokens(line)
    wall, active = (int(v) if isinstance(v, str) and re.fullmatch(r"[0-9]+", v) else None
                    for v in (t.get("duration"), t.get(ACTIVE_TOKEN[:-1])))
    return {"wall": wall, "active": active, "lane": active if active is not None else wall}


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


# ---- the approved queue (p30-4; vault-grammar § Approved queue) ---------------------------------------------------

def _on_merge(note):
    """A note's `on_merge:` as read, {value, error}, or None when its frontmatter has no top-level `on_merge:` line. The
    value is the first such line's scalar lower-cased (_scalar: quotes and an inline ` # comment` dropped), so
    `Regenerate` and `"REGENERATE"  # x` read `regenerate`; any other value, an empty one included, is unreadable
    (ON_MERGE_BAD). Whether anything reads it is _approved_queue's question."""
    raw = note.get(ON_MERGE_KEY)
    if raw is None:
        return None
    value = _scalar(raw).lower()
    return {"value": value, "error": None if value == ON_MERGE_REGENERATE else ON_MERGE_BAD}


def _approved_queue(note) -> bool:
    """An approved queue (vault-grammar § Approved queue): a parallel note carrying a top-level `hold_until` block and an
    `on_merge:` that reads `regenerate`. An `on_merge` on a serial note or with no rollout hold is read by nothing."""
    om = _on_merge(note)
    return (_shape(note) == SHAPES[0] and note.fm_block(HOLD_KEY) is not None
            and om is not None and om["error"] is None)


def _approved_marks(rollout_note, linked):
    """(kind, detail): the approved queue's own read of what has run (vault-grammar § Approved queue). The Chorus Stage's
    room stops (ROOM_STOP_LINE_RE, step-boundary.py's lines) are no run mark; every mark never_started counts is,
    except a task's `integrating:`, read as an Integration in flight. The first that applies:
      ("run", why): never_started's own marks in its words (`paused:`, `pause_requested`, `completed:`, a
        `## Completion log` or `## Leg log` heading); a `## Pause log` with no line under it, or with a non-blank line
        that is no room stop (a hard pause's, a sign-off's); a linked task's valued `owner:`;
      ("room-stop", "since <stamp>"): the last room-stop line is a start line, lapsed or not (step-boundary.py end's rule);
      ("integrating", [slug, ...]): the sorted linked tasks that carry a valued `integrating:`;
      ("unrun", ""): none of the above."""
    if _valued(rollout_note.get("paused")):
        return "run", f"it carries paused: {_scalar(rollout_note.get('paused'))}"
    if _truthy_flag(rollout_note.get("pause_requested")):
        return "run", "it carries pause_requested"
    if _valued(rollout_note.get("completed")):
        return "run", f"it carries completed: {_scalar(rollout_note.get('completed'))}"
    for heading in STARTED_HEADINGS:
        if heading != PAUSE_LOG_SECTION and rollout_note.has_heading(heading):
            return "run", f"it has a {heading} section"
    last = None
    if rollout_note.has_heading(PAUSE_LOG_SECTION):
        lines = [line.strip() for line in rollout_note.section_text(PAUSE_LOG_SECTION).split("\n") if line.strip()]
        if not lines:
            return "run", f"it has a {PAUSE_LOG_SECTION} section"
        for line in lines:
            m = ROOM_STOP_LINE_RE.match(line)
            if not m:
                return "run", f"it has a {PAUSE_LOG_SECTION} line that is no room stop"
            last = (m.group(1), "start" if m.group(2) == ": " else "ended")
    ordered = sorted(linked, key=lambda pn: (pn[0].stem.lower(), str(pn[0])))
    for path, note in ordered:
        if _valued(note.get("owner")):
            return "run", f"its task {path.stem} carries owner: {_scalar(note.get('owner'))}"
    if last is not None and last[1] == "start":
        return "room-stop", f"since {last[0]}"
    integ = sorted({path.stem for path, note in ordered if _valued(note.get("integrating"))}, key=str.lower)
    if integ:
        return "integrating", integ
    return "unrun", ""


def approved_unrun(rollout_note, linked):
    """(True, '') when nothing has run the rollout, else (False, reason): never_started, widened for an approved queue
    (_approved_queue) whose only marks are the Chorus Stage's room stops, each one ended (_approved_marks reads
    `unrun`). A room stop that still stands reads (False, 'a room stop stands since <stamp>'), and a task's
    `integrating:` keeps never_started's reason. Read by `carry` (--from), `approve-queue` and unfinished-rollout.py;
    never_started itself is unchanged, and every other reader keeps it."""
    fresh, why = never_started(rollout_note, linked)
    if fresh or not _approved_queue(rollout_note):
        return fresh, why
    kind, detail = _approved_marks(rollout_note, linked)
    if kind == "unrun":
        return True, ""
    if kind == "room-stop":
        return False, f"a room stop stands {detail}"
    if kind == "integrating":
        first = next(note for path, note in sorted(linked, key=lambda pn: (pn[0].stem.lower(), str(pn[0])))
                     if path.stem == detail[0])
        return False, f"its task {detail[0]} carries integrating: {_scalar(first.get('integrating'))}"
    return False, detail


def _norm_project(value) -> str:
    """A `projects:` entry as unfinished-rollout.py's norm_project reads it: the wikilink's note name, lower-cased, every
    run of non-alphanumerics turned into `-`, trimmed."""
    name = _wikilink_slug(_scalar(value)) or ""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _live_rollout(tasks_dir: Path, value) -> bool:
    """Schedule step 1's skip rule: a `rollout:` value that links a rollout note directly in the tasks dir that is neither
    done nor dropped."""
    slug = _wikilink_slug(_scalar(value))
    path = tasks_dir / f"{slug}.md" if slug else None
    if path is None or not path.is_file():
        return False
    try:
        return _status(Note(path)) not in CLOSED_ROLLOUT_STATUSES
    except (OSError, ValueError):
        return False


def _approved_members(rollout_path: Path, rollout_note, rows, index, tasks_dir: Path) -> dict:
    """The tasks an approved queue's regenerate takes (`next`'s verdict; vault-grammar § Approved queue): {members,
    successor, linked}. Linked rows: this note's rows in CARRIED_STATES, plus each successor's (a never-started rollout
    note beside it whose `supersedes:` names this one: an interrupted chain's N, I8, whose carry already moved them).
    Siblings: each note directly in the tasks dir at `status: open`, tagged `task` and neither `rollout` nor
    `decisions`, whose name shares a linked row's (slug, phase) by PHASED_STEM_RE (the phase compared by _phase_key) and
    whose `rollout:` links no live rollout note (schedule step 1's skip rule). Every member, linked or sibling, carries
    this note's first project (_norm_project); the rest are left out. members is sorted and deduped; successor is the
    first successor's name or None; linked counts the linked rows the filter kept (0: nothing of its own left)."""
    want = _norm_project(_project(rollout_note) or "")

    def mine(note):
        return bool(want) and want in {_norm_project(v) for v in note.get_list("projects")}

    stem = rollout_path.stem.lower()
    here = rollout_path.parent.resolve()
    successors = []
    for key, (path, note) in sorted(index.items()):
        if path.parent.resolve() != here or "rollout" not in _tags(note) or \
                _status(note) in CLOSED_ROLLOUT_STATUSES or _link_slug(note, "supersedes") != stem:
            continue
        n_linked = [(p, n) for p, n in index.values()
                    if (_wikilink_slug(n.get("rollout")) or "").lower() == path.stem.lower()]
        if never_started(note, n_linked)[0]:
            successors.append((path, n_linked))
    linked = [(r["path"], r["note"]) for r in rows if r["state"] in CARRIED_STATES]
    for _path, n_linked in successors:
        linked += [(p, n) for p, n in n_linked if _queue_state(n)[0] in CARRIED_STATES]
    kept = sorted({p.stem for p, n in linked if mine(n)}, key=str.lower)
    phases = {(m.group("slug").lower(), _phase_key(m.group("n"))) for m in (PHASED_STEM_RE.match(s) for s in kept) if m}
    siblings = set()
    root = tasks_dir.resolve()
    for key, (path, note) in index.items():
        m = PHASED_STEM_RE.match(path.stem)
        if not m or (m.group("slug").lower(), _phase_key(m.group("n"))) not in phases or path.parent.resolve() != root:
            continue
        tags = _tags(note)
        if _status(note) != "open" or "task" not in tags or tags & {"rollout", "decisions"} or not mine(note) or \
                _live_rollout(tasks_dir, note.get("rollout")):
            continue
        siblings.add(path.stem)
    members = sorted(set(kept) | siblings, key=str.lower)
    return {"members": members, "successor": successors[0][0].stem if successors else None, "linked": len(kept)}


def _chain_start(rollout_path: Path, rollout_note, linked, index):
    """`status`'s chainStart (vault-grammar § Approved queue): {prior, pr} when this note is a chain's N whose start was
    never stamped (the lead died after schedule step 7.5, before its stamp-start): never started (never_started), no
    `start: unattended` and no valued `started_unattended:`, and its `supersedes:` names a prior (root or Archive) that
    carries `on_merge: regenerate`; pr is the prior's hold_until pr, else N's own copy. Else None."""
    if not never_started(rollout_note, linked)[0] or _start_unattended(rollout_note) or \
            _valued(rollout_note.get("started_unattended")):
        return None
    prior = _link_slug(rollout_note, "supersedes")
    entry = index.get(prior) if prior else None
    if entry is None:
        return None
    om = _on_merge(entry[1])
    if om is None or om["error"] is not None:
        return None
    hold = _hold_until(entry[1], None) or _hold_until(rollout_note, None)
    return {"prior": entry[0].stem, "pr": hold["pr"] if hold else None}


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


# ---- the RACE revert (ADR 0046; execute § 4.5 *The RACE revert*) --------------------------------------------
# A RACE whose re-verify stays red after the Flake check is reverted on main through a revert PR that merges only
# through merge-task (lead-integrate.py `revert`). Its only `## Race log` lines are these four, each naming the slug
# with a wikilink right after the stamp; merge-task's own text, its `RACE:` line included, is never appended for a
# revert PR.
RACE_REVERT_STARTED_MARK = "revert started:"
RACE_REVERT_OPENED_MARK = "revert opened:"
RACE_REVERTED_MARK = "reverted on main:"
RACE_REVERT_FAILED_MARK = "revert did not land:"
RACE_REVERT_UNVERIFIED_MARK = "main not re-verified"
# `next`'s hold reason for every stalled or queued task while a revert that did not land stands (`mainRed`).
MAIN_RED_PREFIX = "main red:"
# merge-task.sh's exit-5 line, as the RACE procedure appends it to the `## Race log` (merge-task.sh's VMSG).
RACE_LINE_RE = re.compile(r"RACE: PR #(\d+) merged as ([0-9a-f]{40})")
_REVERT_MARKS = (RACE_REVERT_STARTED_MARK, RACE_REVERT_OPENED_MARK, RACE_REVERTED_MARK, RACE_REVERT_FAILED_MARK)


def _race_log_entries(rollout_note):
    """[(stamp, slug, rest)] for every `## Race log` line whose first wikilink names a slug: `rest` is the text after
    that wikilink, stripped. In log order."""
    out = []
    if rollout_note is None:
        return out
    for line in rollout_note.section_text(RACE_LOG_SECTION).split("\n"):
        m = WIKILINK_OPEN_RE.search(line)
        slug = (_wikilink_slug(m.group(1)) or "") if m else ""
        if not slug:
            continue
        rest = line[m.end():]
        rest = rest[rest.index("]]") + 2:] if "]]" in rest else rest
        head = line.strip().lstrip("-").strip()
        out.append((head.split(" ", 1)[0] if head else "", slug, rest.strip()))
    return out


def _race_reverts(rollout_note):
    """{slug_lower: {slug, started, opened, reverted, unverified, failed, failedWhy, failedAt, prOf}} for every slug a
    RACE revert line names in the rollout's `## Race log` (the latest line of each kind wins): `started` the merge M a
    `revert started:` line names, `opened` the `revert opened:` text (`PR #R <url>`), `reverted` the sha a `reverted on
    main:` line names, `unverified` that line reads `main not re-verified`, `prOf` the task PR number it names (`PR #N's
    merge`), `failed` a `revert did not land:` line names the slug, with its reason (`failedWhy`) and stamp
    (`failedAt`)."""
    out = {}
    for stamp, slug, rest in _race_log_entries(rollout_note):
        mark = next((k for k in _REVERT_MARKS if rest.startswith(k)), None)
        if mark is None:
            continue
        e = out.setdefault(slug.lower(), {"slug": slug, "started": None, "opened": None, "reverted": None,
                                          "unverified": False, "failed": False, "failedWhy": None, "failedAt": None,
                                          "prOf": None})
        body = rest[len(mark):].strip()
        if mark == RACE_REVERT_STARTED_MARK:
            e["started"] = body.split(" ", 1)[0] if body else "?"
        elif mark == RACE_REVERT_OPENED_MARK:
            e["opened"] = body or "?"
        elif mark == RACE_REVERTED_MARK:
            e["reverted"] = body.split(" ", 1)[0] if body else "?"
            e["unverified"] = RACE_REVERT_UNVERIFIED_MARK in body
            pm = re.search(r"PR #(\d+)'s merge", body)
            e["prOf"] = int(pm.group(1)) if pm else None
        else:
            e.update(failed=True, failedWhy=body, failedAt=stamp)
    return out


def _race_revert_pending(entry, in_race_held_lane):
    """A RACE revert the lead still owes: started, not failed, and the task's `integrating:` still stands (the landing
    tail's set-aside row, its last write, removes it), so a crash anywhere in the tail stays pending."""
    return bool(entry and entry["started"]) and not entry["failed"] and bool(in_race_held_lane)


def _pr_number(pr):
    """The PR number a `pr:` value names (a PR URL or `#N`), else None."""
    pr = _scalar(pr or "")
    m = PR_URL_RE.match(pr) or PR_NUM_RE.match(pr)
    return int(m.group(m.lastindex)) if m else None


def _reverted_pr(rollout_note, note):
    """True when the rollout's `## Race log` says the note's own `pr:` was reverted on main (a `reverted on main:` line
    naming the note's slug whose `PR #N's merge` is the note's PR number): that merge must never re-enter (resume,
    hand-back, the automatic retry). A new `pr:` (a re-land) passes."""
    e = _race_reverts(rollout_note).get(note.path.stem.lower())
    n = _pr_number(note.get("pr"))
    return bool(e and e["reverted"] and n is not None and e["prOf"] == n)


def _main_red(rollout_note):
    """[{slug, why, stamp}] in `## Race log` order: each RACE whose revert did not land (a `revert did not land:` line)
    that no `repair: [[<slug>]] RACE decided:` line in `## Notes` lifts. main is red, so the whole rollout is held until
    Lachy decides. It reads the rollout note alone, never the task note's status: a task dropped or deferred by hand
    does not make main green."""
    if rollout_note is None:
        return []
    reverts = _race_reverts(rollout_note)
    decided = {(_wikilink_slug(m.group(1)) or "").lower()
               for m in RACE_DECIDED_RE.finditer(rollout_note.section_text(NOTES_SECTION))}
    out, seen = [], set()
    for _stamp_, slug, rest in _race_log_entries(rollout_note):
        key = slug.lower()
        if not rest.startswith(RACE_REVERT_FAILED_MARK) or key in seen or key in decided:
            continue
        seen.add(key)
        e = reverts[key]
        out.append({"slug": e["slug"], "why": e["failedWhy"], "stamp": e["failedAt"]})
    return out


# ---- the git-env hold (execute § 4.5 *Git-env canary*) ------------------------------------------------------

GIT_ENV_LOG_SECTION = "## Git-env log"
GIT_ENV_TRIP_MARK = "git-env trip"
GIT_ENV_ACK_MARK = "git-env ack"
# A Bookkeeping miss whose state check passed (ADR 0046): logged with the checkout's state, it holds nothing.
GIT_ENV_MISS_MARK = "git-env miss"
# A bare checkout holds the whole rollout (linked worktrees share the root's config): a trip line whose change reads
# `core.bare false→true`, `core.bare true at arm`, or a failed state check's `core.bare true`. Every other trip holds the
# Integration lane only.
GIT_ENV_BARE_RE = re.compile(r"core\.bare (?:false→)?true(?!→)")


def _git_env_scope(line):
    """A trip line's scope (ADR 0046): `rollout` when it reads a bare checkout (GIT_ENV_BARE_RE), else `lane`."""
    return "rollout" if GIT_ENV_BARE_RE.search(line or "") else "lane"


def _git_env_hold(rollout_note):
    """The unacked git-env trips (the module docstring's "Git-env hold"): an ordered [{slug, kind, line, scope}] of the
    `## Git-env log` trip lines that no later ack line names. A trip line's slug is the first wikilink after the
    mark and its kind the word before the next `:`; an ack line names every wikilink it carries; `scope` is
    _git_env_scope's (`rollout` for a bare checkout, else `lane`). A miss line (GIT_ENV_MISS_MARK) holds nothing and a
    line with neither mark is ignored. `rollout_note` None has no log, so no hold."""
    if rollout_note is None:
        return []
    trips = []
    for line in rollout_note.section_text(GIT_ENV_LOG_SECTION).split("\n"):
        line = line.rstrip()
        if GIT_ENV_MISS_MARK in line:
            continue
        if GIT_ENV_TRIP_MARK in line:
            rest = line[line.index(GIT_ENV_TRIP_MARK) + len(GIT_ENV_TRIP_MARK):]
            m = WIKILINK_OPEN_RE.search(rest)
            slug = (_wikilink_slug(m.group(1)) or "") if m else ""
            if not slug:
                continue
            tail = rest[m.end():]
            tail = tail[tail.index("]]") + 2:] if "]]" in tail else tail
            km = re.match(r"\s*([A-Za-z-]+)\s*:", tail)
            trips.append({"slug": slug, "kind": km.group(1) if km else "", "line": line, "scope": _git_env_scope(line)})
        elif GIT_ENV_ACK_MARK in line:
            acked = {(_wikilink_slug(m.group(1)) or "").lower() for m in WIKILINK_OPEN_RE.finditer(line)}
            trips = [t for t in trips if t["slug"].lower() not in acked]
    return trips


# The Lane hold (ADR 0048; p29-7; the module docstring's "Lane hold"): a cause that reaches every merge holds the
# Integration lane, never the whole rollout, until Lachy's ack through /thread:repair § 3g. Its log is the rollout
# note's `## Lane log`, written only by `lane-hold` and `lane-ack`, at the note's end (a new section is appended there),
# so its wikilinks never rank a task ahead of the `## Queue` row that already links it.
LANE_LOG_SECTION = "## Lane log"
LANE_HOLD_CAUSES = ("merge-task-abort", "merge-task-env", "integrate-env", "verify-noslot")
LANE_HOLD_RE = re.compile(r"^- (\S+) lane hold \[\[([^\]|#\\]+)\]\] (" + "|".join(map(re.escape, LANE_HOLD_CAUSES))
                          + r"): (.*)$")
# An ack's slugs are the wikilinks before its first `]]: `; his words follow it.
LANE_ACK_RE = re.compile(r"^- (\S+) lane ack (.*?\]\]): (.*)$")
LANE_EVIDENCE_MAX = 200


def _lane_log_hold(rollout_note):
    """The unacked Lane-log holds: [{slug, cause, stamp, line}] in log order, the `## Lane log` hold lines
    (LANE_HOLD_RE) no later ack line (LANE_ACK_RE) names. A hold after an ack holds again; a second unacked line for the
    same slug and cause adds nothing. `rollout_note` None has no log, so no hold."""
    if rollout_note is None:
        return []
    holds = []
    for raw in rollout_note.section_text(LANE_LOG_SECTION).split("\n"):
        line = raw.rstrip()
        m = LANE_HOLD_RE.match(line)
        if m:
            slug = _wikilink_slug(m.group(2)) or m.group(2)
            if not any(h["slug"].lower() == slug.lower() and h["cause"] == m.group(3) for h in holds):
                holds.append({"slug": slug, "cause": m.group(3), "stamp": m.group(1), "line": line})
            continue
        a = LANE_ACK_RE.match(line)
        if a:
            acked = {(_wikilink_slug(x.group(1)) or "").lower() for x in WIKILINK_OPEN_RE.finditer(a.group(2))}
            holds = [h for h in holds if h["slug"].lower() not in acked]
    return holds


def _lane_log_named(rollout_note):
    """Every slug (lowercased) a `## Lane log` hold line names, acked or not: lane-ack's refusal reads it."""
    if rollout_note is None:
        return set()
    out = set()
    for raw in rollout_note.section_text(LANE_LOG_SECTION).split("\n"):
        m = LANE_HOLD_RE.match(raw.rstrip())
        if m:
            out.add((_wikilink_slug(m.group(2)) or m.group(2)).lower())
    return out


def _queue_links(rollout_note):
    """The slugs (lowercased) wikilinked on a list-item or table-row line of the rollout note's `## Queue` section only,
    outside fenced code, read as _schedule_positions reads them: lane-hold's membership check for a task note it cannot
    read."""
    out, fenced = set(), False
    for line in rollout_note.section_text("## Queue").split("\n"):
        if FENCE_RE.match(line):
            fenced = not fenced
            continue
        if fenced or not RANKED_LINE_RE.match(line):
            continue
        for m in WIKILINK_OPEN_RE.finditer(line):
            slug = (_wikilink_slug(m.group(1)) or "").lower()
            if slug:
                out.add(slug)
    return out


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
    rollouts.toml's [repo."<slug>"], then [defaults], then the built-in. {settings, test_credentials, error, cause,
    where}: settings is resolve()'s `settings` object (each key {value, source}), or None when it cannot resolve, and
    then error is the resolver's own words and cause what the error needs: "resolver" (rollout-settings.py would not
    load, or failed), "root" (a `--repo` refusal: the Project root is gone or its origin unreadable) or "file"
    (rollouts.toml was refused; `where` names its path and line). test_credentials is resolve()'s field of that name
    ({value, source}: the repo's test-credential class, ADR 0062; value None with no class, as with no Project root),
    or None on an error. The one loader _resolved_ceiling, _resolved_caps, _retry_budget and the standing approval
    share; it writes nothing and never raises."""
    root = _project_root(rollout_note)
    try:
        mod = _settings_module()
    except Exception as e:
        return {"settings": None, "test_credentials": None, "error": f"rollout-settings.py would not load: {e}",
                "cause": "resolver", "where": ""}
    try:
        out = mod.resolve(repo=None if root is None else str(root))
        return {"settings": out["settings"], "test_credentials": out.get("test_credentials"), "error": None,
                "cause": None, "where": ""}
    except mod.SettingsError as e:
        if (e.subject or "").startswith("--repo "):
            return {"settings": None, "test_credentials": None, "error": str(e), "cause": "root", "where": ""}
        where = f"{e.subject} at line {e.line}" if e.line is not None else f"{e.subject}"
        return {"settings": None, "test_credentials": None, "error": str(e), "cause": "file", "where": where}
    except Exception as e:
        return {"settings": None, "test_credentials": None, "error": f"rollout-settings.py failed: {e}",
                "cause": "resolver", "where": ""}


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


def _verify_timeout(rollout_note, key="verify_timeout"):
    """(seconds, error): `verify_timeout` (or the completion verify's `completion_timeout`, which reads its own
    absent forms first), an integer from 1 to MAX_VERIFY_TIMEOUT; absent -> 1800; anything else -> error. Read like
    `parallel_ceiling` (_scalar: a quoted value or a trailing ` # comment` is fine). Only the rollout note is read,
    so a task-level key never applies."""
    raw = rollout_note.get(key)
    if raw is None:
        return DEFAULT_VERIFY_TIMEOUT, None
    s = _scalar(raw)
    if re.fullmatch(r"[0-9]+", s) and 1 <= int(s) <= MAX_VERIFY_TIMEOUT:
        return int(s), None
    return None, f"{key} must be an integer from 1 to {MAX_VERIFY_TIMEOUT}, got {raw!r}"


def _verify_slots():
    """(slots, error): the machine's `verify_slots` (rollout-settings.py, machine-wide); error the resolver's words."""
    settings, err = _machine_settings()
    if err:
        return None, err
    try:
        return settings["verify_slots"]["value"], None
    except Exception as e:
        return None, f"rollout-settings.py failed: no verify_slots ({e})"


def _slot_wait(seconds):
    """The verify-slot wait a verify of `seconds` gets inside the harness cap: max(60, 7200 - 600 - seconds)."""
    return max(VERIFY_SLOT_WAIT_MIN, HARNESS_MAX_S - VERIFY_HARNESS_MARGIN - seconds)


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


def _eta_width(ceiling, away, elsewhere):
    """(n, by): how many of this rollout's tasks run at once for the ETA (p28-6), the Trickle's limit (execute away.md's
    slotLimit, min(ceiling, max(0, cap - the count elsewhere - the places kept))) floored at 1 and without the Heat hold
    or a fair share's kept places (p28-5), which pass: a full Mac still drains one at a time, and the ETA never divides
    by zero. `by` is "ceiling" when the ceiling binds,
    else "trickle" (not Away) or "away cap" (Away). `away` is _away_state's, `elsewhere` _elsewhere_running's. A ceiling
    of None (unresolved) gives (None, "ceiling"): _timeline then has no remaining."""
    if not ceiling:
        return None, "ceiling"
    room = max(1, _cap_in_force(away)["n"] - sum(elsewhere.values()))
    if ceiling <= room:
        return ceiling, "ceiling"
    return room, "away cap" if away["away"] else "trickle"


def _timeline(rows, counts, ceiling, now, width=None):
    """The per-task progress/ETA block, or None when no task has a parseable `started:`. In-rollout
    arithmetic only, deliberately rough (always labelled `~… (rough)`): the mean per-task duration
    (started -> merged) x the chunks still ahead at the limit, `width` (_eta_width's (n, by): the ceiling, or the
    Trickle's or the Away cap's room on this Mac), reported as etaWidth and etaBy. With no width it is the ceiling's."""
    n, by = width if width is not None else (ceiling, "ceiling")
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
    remaining = int(round(avg * math.ceil(pending / n))) if (avg is not None and pending and n) else None
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
        "etaWidth": n,
        "etaBy": by,
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
    rows, index = _rows(rollout_path, rollout_note, tasks_dir)
    counts = _counts(rows)
    ceiling, _err = _ceiling(rollout_note)
    # The ETA's width (p28-6): the Away state and the count elsewhere, read silently (only `next` prints the WARN), with
    # every other rollout's lease read at `now` (p28-4: a lapsed one leaves the count).
    width = _eta_width(ceiling, _away_state(now), _elsewhere_running(rollout_path, tasks_dir, index, _Leases(now)))
    return _progress_line(counts, _timeline(rows, counts, ceiling, now, width))


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
    raw = getattr(args, "_result_raw", None)  # read once by the Engine snapshot guard (_guarded_notes)
    if raw is None:
        raw = sys.stdin.read() if args.result == "-" else Path(os.path.expanduser(args.result)).read_text()
    data = json.loads(raw)
    tasks = data.get("tasks", [])
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    now = _now(args)
    errors = []
    warnings = []
    top = None  # (name, source) of the ladder's top rung, read once, only for a pre-3.0.0 row
    for task in tasks:
        integ = task.get("integration")
        if args.no_verdict and isinstance(integ, dict) and integ.get("outcome") == "integrated":
            # ADR 0053: a trip inside the integrate call's window was acked before its check, so its verdict is void.
            task = {**task, "integration": {**integ, "outcome": "void"}}
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
        # p29-12: a row that ends a Slot (its note read in_progress, and no integrate row) is its call's end, and the
        # lead reconciles it at its next turn, which may come hours later (a lead held or idle). So what records that
        # end (`ready:`, a read-only approval's `merged:`, and the row's Slot events) is read from the call itself
        # (_call_end), falling back to now, marked, only when no end is readable.
        ends_slot = prior == "in_progress" and not isinstance(task.get("integration"), dict)
        ended = _call_end(rollout, slug, now) if ends_slot else None
        at = ended or now
        stamped = []  # the call-end stamps this row writes, for its line
        # A read-only task is done when its review approves: nothing to merge, so it never enters
        # Integration (ADR 0030). The row's scope wins; the note's own is the fallback.
        scope = _scalar(task.get("scope")).lower() or _scope(note)
        note_status = "done" if (status == "review" and not pr and scope == "read-only") else status
        # `ready:` is when the task joined the Integration queue: the approving own (or seeded revise)
        # call returned (the engine's readyAt), so it is that call's end (p29-12). Stamped on a move to review
        # from another status, overwriting any earlier value; never on a read-only task (it never enters
        # Integration) and never on an Integration row (an integrated set-aside re-entering review is leaving
        # Integration, not joining the queue).
        if (note_status == "review" and _status(note) != "review" and scope != "read-only"
                and task.get("integration") is None):
            note.set("ready", _stamp(at))
            ready_stamped = True
            stamped.append(f"ready={_stamp(at)}")
        note.set("status", note_status)
        # Its approval is its completion, so it is stamped `merged:` as a PR task is at its merge (the
        # first stamp wins), at its call's end: its duration then counts in the timeline, and a read-only
        # task finishing last ends the rollout's elapsed time.
        if note_status == "done" and not _scalar(note.get("merged")):
            note.set("merged", _stamp(at))
            stamped.append(f"merged={_stamp(at)}")
        if stamped and ended is None:
            stamped.append("(fallback)")
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
            # p29-13: its `active=`, the wall less the stalls inside the window: the rollout's Run record's stops and
            # the Mac's sleeps the record does not hold yet (else the integrate call's journal gaps), read before this
            # row's own events are written.
            m = integration.get("metrics") if isinstance(integration.get("metrics"), dict) else {}
            active = _active_minutes(rollout, slug, m.get("startedAt"), m.get("finishedAt"), m.get("durationMinutes"),
                                     call=True, now=now)
            note.append_line(INTEGRATION_LOG_SECTION, _integration_log_line(task, active))
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

        try:
            note.save(dry_run=args.dry_run)
        except OSError as e:
            # This row's error, never the whole reconcile's: the other rows still land (Note.save's lock timeout,
            # an edit it cannot re-apply, a note moved away meanwhile).
            errors.append(f"{slug}: cannot write {path}: {e} — nothing written for this row")
            continue
        _reconcile_events(args, rollout, slug, task, note, prior, held, lane_fields, note_status, _pr(note),
                          ready_stamped, ended, now)
        _review_verdict_events(args, rollout, slug, task, prior, ended, now)
        flake_lines = _row_flakes(args, rollout, slug, task, note, tasks_dir, errors, warnings)
        flag = " (dry-run)" if args.dry_run else (" [written]" if note.dirty else " [no-change]")
        ro = " (read-only, approved)" if note_status != status else ""
        when = "".join(" " + s for s in stamped)
        print(f"{slug}: status={note_status}{ro}{(' pr=' + pr) if pr else ''}{_rung_note(task)}{legacy_note}{when}"
              f"{flag}")
        for line in flake_lines:
            print(line)

    for w in warnings:
        print(f"WARNING: {w}", file=sys.stderr)
    for e in errors:
        print(f"ERROR: {e}", file=sys.stderr)
    return 1 if errors else 0


# ---- the Trickle and the Away cap (Chorus ADR 0104 d2, d6; ADR 0049; execute away.md) ----------------------------

AWAY_FILE_REL = ".config/thread/away.json"                    # under the home dir, resolved at call time
AWAY_KEYS = ("away", "until", "morning", "trickle", "written_at")  # all required, in away.md's key-table order
DEFAULT_TRICKLE = 2                                            # missing, stale or unreadable: not Away, at this
AWAY_STALE_AFTER = timedelta(hours=24)                         # a written_at older than this reads stale
AWAY_FUTURE_SKEW = timedelta(minutes=5)                        # a written_at further ahead than this reads stale
AWAY_MAX_BYTES = 64 * 1024
MORNING_RE = re.compile(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]\Z", re.ASCII)
AWAY_WARN = "WARN: ~/.config/thread/away.json"                 # the stale / unreadable stderr line's prefix
TRICKLE_PREFIX = "trickle:"                                    # a row held for want of a Trickle Slot
# The Away cap (p29-8, ADR 0049): the Mac-wide cap while Away. Optional, after AWAY_KEYS (the key table's last row),
# so a reader from before it (p28-1, ADR 0043) ignores it as an extra key; a present one is an integer above `trickle`.
AWAY_CAP_KEY = "away_cap"
AWAY_CAP_DEFAULT = 4      # the key absent, or any reading but fresh: twice the Mac's two Verify slots (verify-slot.py)
AWAY_CAP_PREFIX = "away cap:"                                  # a row held for want of an Away-cap Slot
# The Trickle claims (p28-3; execute away.md § The Trickle, *Trickle claims*): `next`'s own file and lock, beside the
# note locks (_note_lock_dir). The lock is a file of its own: the claims file is replaced whole (no stable inode).
TRICKLE_LOCK = "trickle.lock"
TRICKLE_CLAIMS = "trickle-claims.json"
TRICKLE_CLAIMS_VERSION = 1
TRICKLE_CLAIM_TTL = timedelta(minutes=20)    # one heartbeat tick: a claim no § 4 stamp consumes lapses then
TRICKLE_CLAIMS_MAX_BYTES = 256 * 1024
TRICKLE_WARN = "WARN: trickle claims"                          # every claims stderr line's prefix
TRICKLE_CLAIM_KEYS = ("tasksDir", "rollout", "slug", "at")
# The fair share (p28-5; execute away.md § The Trickle, *A fair share*): the claims file's `waiting` list, one record
# per rollout whose lead's `next` held a row on the Mac-wide cap or the heat, so every other lead keeps a freed place
# for it in turn. A record no later write replaces lapses after TRICKLE_WAIT_TTL from its `at` (a gone lead).
TRICKLE_WAIT_TTL = timedelta(minutes=30)
TRICKLE_WAIT_KEYS = ("tasksDir", "rollout", "since", "at", "served", "want")
# A lead's lease (p28-4; execute away.md § The Trickle): ~/.config/thread/leases/<rollout stem>.json under the home dir
# at call time, {rollout, written_at, by}, rewritten by every `next` off --dry-run once its refusals pass and by every
# record-entry. A rollout whose lease has lapsed leaves the Mac-wide count unless a room stop stands; a rollout with no
# lease file (an older engine snapshot, ADR 0043) or an unreadable one still counts.
LEASE_DIR_REL = ".config/thread/leases"
LEASE_LAPSE = timedelta(minutes=45)       # two */20 heartbeat ticks and 5 minutes, from the last write or a later wake
LEASE_MAX_BYTES = 4 * 1024
LEASE_WARN = "lease: warning:"                                 # the one stderr line a write that fails prints
# The last starts and the night record (Chorus ADR 0104 d4 and its Consequences; execute away.md).
LAST_START_PREFIX = "last start:"                              # a row held because it would run past the Morning
LAST_START_FALLBACK = timedelta(hours=2)                       # a kind with no history starts nothing this close to it
LAST_START_MIN_RUNS = 3                                        # fewer past runs of a kind than this is no history
LAST_START_HISTORY = timedelta(days=30)                        # a past run counts when it ended within this window
LAST_START_HORIZON = timedelta(hours=24)                       # a Morning further out than this holds nothing yet
UNSCOPED_KIND = "unscoped"                                     # the kind of a task whose note has no `scope:`
NIGHT_KINDS = ("away-night", "last-start-held", "ran-past-morning")  # the night record's Run-record kinds
HEAT_PREFIX = "heat:"                                          # a row the Heat hold holds (estate ADR 0009 d5)
_HEAT_MOD = None


def _heat_module():
    """verify-slot.py as a module, for its heat reading (loaded once per process), or None when it will not load
    (Windows: its `import fcntl` fails, so `next` still runs there). Never raises."""
    global _HEAT_MOD
    if _HEAT_MOD is None:
        try:
            spec = importlib.util.spec_from_file_location("thread_verify_slot", VERIFY_SLOT_PY)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            _HEAT_MOD = mod
        except Exception:
            _HEAT_MOD = False
    return _HEAT_MOD or None


def _heat_state() -> dict:
    """The Heat hold's reading for `next` (execute away.md § Heat): {level, name, held}, through verify-slot.py's
    heat_level() (THREAD_HEAT_LEVEL pins it), read once per call. held is true at heavy (HEAT_HOLD) or worse. Fails
    open: a module that will not load, or a reading that raises, reads 0 nominal."""
    mod = _heat_module()
    try:
        level = int(mod.heat_level()) if mod else 0
        return {"level": level, "name": mod.heat_name(level) if mod else "nominal",
                "held": bool(mod) and level >= mod.HEAT_HOLD}
    except Exception:
        return {"level": 0, "name": "nominal", "held": False}


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
    if AWAY_CAP_KEY in data:  # optional, and the key table's last row, so it is checked last
        why = _away_field(AWAY_CAP_KEY, data[AWAY_CAP_KEY], data["trickle"])
        if why:
            return "unreadable", f"`{AWAY_CAP_KEY}` {why}", None
    return "ok", None, data


def _away_field(key, value, trickle=None):
    """None when one of AWAY_KEYS, or AWAY_CAP_KEY (checked against the file's `trickle`), holds a well-typed value,
    else what is wrong with it (away.md's key table)."""
    if key == "away":
        return None if isinstance(value, bool) else "is not a JSON boolean"
    if key in ("until", "written_at"):
        why = _away_stamp(value)[1]
        return f"is {why}" if why else None
    if key == "morning":
        return None if isinstance(value, str) and MORNING_RE.match(value) else 'is not "HH:MM" (00:00 to 23:59)'
    # trickle and away_cap: a JSON integer of at least 1; a bool, a float, a string, null or 0 is refused (neither cap
    # is ever 0)
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        return "is not a JSON integer of at least 1"
    if key == AWAY_CAP_KEY and value <= trickle:  # the Away cap is always above the Trickle (ADR 0049)
        return "is not above `trickle`"
    return None


def _away_state(now) -> dict:
    """The Away state `next` reads (execute away.md § Reading it): {away, file, why, limit, awayCap, until, morning}.
    `file` is fresh, missing, stale or unreadable; `why` is null only when fresh. Anything but fresh reads not Away at
    DEFAULT_TRICKLE with the Away cap at AWAY_CAP_DEFAULT, and a stale file's own `trickle` and `away_cap` are ignored.
    Fresh, `awayCap` is the file's `away_cap`, else AWAY_CAP_DEFAULT lifted to `trickle` + 1 when the Trickle reaches
    it (the Away cap is always above the Trickle). Stale is any of: `until` <= now; now - `written_at` over 24 h;
    `written_at` more than 5 minutes after now. `until` and `morning` are the file's, reported only when fresh. The path
    is the home dir's at call time (a pinned HOME is the only override)."""
    out = {"away": False, "file": "missing", "why": None, "limit": DEFAULT_TRICKLE, "awayCap": AWAY_CAP_DEFAULT,
           "until": None, "morning": None}
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
    out.update(away=data["away"], file="fresh", limit=data["trickle"], until=data["until"], morning=data["morning"],
               awayCap=data.get(AWAY_CAP_KEY, max(AWAY_CAP_DEFAULT, data["trickle"] + 1)))
    return out


def _cap_in_force(away) -> dict:
    """The Mac-wide cap an Away state puts in force (_away_state): {away, n, file}, n the Away cap while Away, else the
    Trickle. slot-taken's `cap` (the Run record), so a Reflection reads each Slot against it (ADR 0032, 0049)."""
    return {"away": away["away"], "n": away["awayCap"] if away["away"] else away["limit"], "file": away["file"]}


def _last_room_stop(note):
    """(stamp, 'start' | 'ended') for the last room-stop line (ROOM_STOP_LINE_RE) of the note's PAUSE_LOG_SECTION, or
    None: step-boundary.py's begin, end and stands read it, and so do the lease (_room_stop_stands) and `moving`."""
    last = None
    for line in note.section_text(PAUSE_LOG_SECTION).split("\n"):
        m = ROOM_STOP_LINE_RE.match(line.strip())
        if m:
            last = (m.group(1), "start" if m.group(2) == ": " else "ended")
    return last


def _room_stop_stands(note, now) -> bool:
    """Whether a room stop stands on the rollout note at `now`, as step-boundary.py `stands` exits 0: its last room-stop
    line is a start line whose stamp parses and is under ROOM_STOP_BOUND old. An `ended` line last, none, an unparseable
    stamp or one at or past the bound: False."""
    return _room_standing(_last_room_stop(note), now) == 0


def _lease_path(stem) -> Path:
    """The rollout's lease file (p28-4): LEASE_DIR_REL under the home dir at call time (a pinned HOME is the only
    override, as for the Away state file)."""
    return Path.home() / LEASE_DIR_REL / f"{stem}.json"


def _lease_write(stem, now, by):
    """Rewrite the rollout's lease (p28-4; execute away.md § The Trickle): {rollout, written_at (`now`, UTC Z to the
    second), by ("next" or "entry")}, through a temp file beside it and os.replace, so a reader never sees a torn file
    and of two writers the last wins. LEASE_DIR_REL is created only under an existing home dir. Best-effort: a failure
    prints one LEASE_WARN line on stderr, never raises and changes no exit code and no stdout."""
    tmp = None
    try:
        path = _lease_path(stem)
        if not Path.home().is_dir():
            why = "no home directory"
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(json.dumps({"rollout": stem, "written_at": _utc_z(now), "by": by}) + "\n")
            os.replace(tmp, path)
            tmp, why = None, None
    except (OSError, RuntimeError, ValueError) as e:   # RuntimeError: Path.home() with no home to resolve
        why = (e.strerror if isinstance(e, OSError) else None) or str(e) or type(e).__name__
    finally:
        if tmp is not None:
            try:
                os.unlink(tmp)
            except OSError:
                pass
    if why:
        print(f"{LEASE_WARN} cannot write ~/{LEASE_DIR_REL}/{stem}.json: {why}", file=sys.stderr)


def _lease_read(stem):
    """(state, written_at, why) for the rollout's lease file (_lease_path): state `none` (no file, or a plain file in a
    directory's place), `unreadable` (any other OSError, a directory at the path included; over LEASE_MAX_BYTES, not
    UTF-8, not JSON, not an object; a `written_at` missing, ill-typed or naive) or `ok`, with written_at the aware stamp
    (else None). why says how it is not ok, else None. Extra keys are ignored."""
    try:
        with open(_lease_path(stem), "rb") as f:
            raw = f.read(LEASE_MAX_BYTES + 1)
    except (FileNotFoundError, NotADirectoryError):
        return "none", None, "no file"
    except (OSError, RuntimeError) as e:
        return "unreadable", None, f"cannot read it ({getattr(e, 'strerror', None) or type(e).__name__})"
    if len(raw) > LEASE_MAX_BYTES:
        return "unreadable", None, "over 4 KiB"
    try:
        data = json.loads(raw.decode("utf-8"))
    except UnicodeDecodeError:
        return "unreadable", None, "not UTF-8"
    except (ValueError, RecursionError):
        return "unreadable", None, "not JSON"
    if not isinstance(data, dict):
        return "unreadable", None, "not a JSON object"
    if "written_at" not in data:
        return "unreadable", None, "no `written_at`"
    written, why = _away_stamp(data["written_at"])
    if why:
        return "unreadable", None, f"`written_at` is {why}"
    return "ok", written, None


class _Leases:
    """The leases one call reads (p28-4; execute away.md § The Trickle), at `now`. A lease lapses 45 minutes
    (LEASE_LAPSE) after its last write, or after the Mac's latest boot or wake if later: its start is the latest of
    `written_at` and kern.boottime and kern.waketime, each counted only when after `written_at` and at or before now,
    and it lapses once now - start > LEASE_LAPSE (exactly 45:00 still reads fresh). The Mac's evidence is
    machine_times(now, now), so sysctl only, never pmset (THREAD_MACHINE_TIMES in its place), read lazily, at most once
    per call, and only when some lease would otherwise lapse. A lapsed lease whose rollout note has a room stop standing
    (_room_stop_stands, under ROOM_STOP_BOUND) reads `room-stop` and counts."""

    def __init__(self, now):
        self.now = now
        self._up = None

    def _ups(self):
        """The Mac's latest boot and wake at or before now (aware datetimes; either absent when unknown)."""
        if self._up is None:
            mt = machine_times(self.now, self.now)
            self._up = tuple(t for t in (mt["boot"], mt["wake"]) if t is not None and t <= self.now)
        return self._up

    def state(self, stem, note) -> dict:
        """{state, writtenAt, lapsesAt} for the rollout `stem` (its note `note`, for a standing room stop). state is
        `fresh`, `lapsed`, `room-stop`, `none` (no file) or `unreadable` (_lease_read's, or a `written_at` more than
        AWAY_FUTURE_SKEW ahead of now). writtenAt is the lease's `written_at` (UTC Z), null for none and unreadable;
        lapsesAt is start + LEASE_LAPSE for fresh and lapsed, else null."""
        state, written, _why = _lease_read(stem)
        if state == "ok" and written - self.now > AWAY_FUTURE_SKEW:
            state = "unreadable"
        if state != "ok":
            return {"state": state, "writtenAt": None, "lapsesAt": None}
        start = written
        if self.now - start > LEASE_LAPSE:
            start = max([written] + [t for t in self._ups() if t > written])
        out = {"state": "fresh", "writtenAt": _utc_z(written), "lapsesAt": _utc_z(start + LEASE_LAPSE)}
        if self.now - start > LEASE_LAPSE:
            if _room_stop_stands(note, self.now):
                out.update(state="room-stop", lapsesAt=None)
            else:
                out["state"] = "lapsed"
        return out

    def counts(self, stem, note) -> bool:
        """Whether the rollout's running tasks count in the Mac-wide count: every state but `lapsed`."""
        return self.state(stem, note)["state"] != "lapsed"


def _elsewhere_running(rollout_path: Path, tasks_dir: Path, index, leases=None, lapsed=None) -> dict:
    """{<rollout stem>: n} for every other open, started, parallel Rollout on the Mac running n > 0 tasks whose lead's
    lease has not lapsed, sorted (execute away.md § The Trickle): _running_by_rollout with this rollout excluded, its
    `leases` and `lapsed` passed through."""
    return _running_by_rollout(tasks_dir, index, exclude=rollout_path, leases=leases, lapsed=lapsed)


def _note_index(tasks_dir: Path) -> dict:
    """_scan's index with no rollout left out: stem (lowercased) -> (path, Note) for every note under tasks_dir, Archive
    included, a root copy preferred over an archived one."""
    index = {}
    for path in sorted(tasks_dir.rglob("*.md")):
        try:
            note = Note(path)
        except (OSError, ValueError):
            continue
        key = path.stem.lower()
        prev = index.get(key)
        if prev is None or (prev[0].parent != tasks_dir and path.parent == tasks_dir):
            index[key] = (path, note)
    return index


def mac_running(tasks_dir, reraise=()):
    """The Mac-wide count of running Rollout tasks, every rollout included (the Trickle's count, execute away.md: the Run
    record's suite `running`, p29-10), from one walk of `tasks_dir`, each rollout's lease read at the clock's now (a
    lapsed one leaves the count, p28-4); None when it cannot be walked. An exception in `reraise` (the caller's stop
    signal, raised by its handler mid-walk, the lease's sysctl read included) propagates: the walk never swallows a
    stop."""
    try:
        tasks_dir = Path(os.path.expanduser(str(tasks_dir)))
        if not tasks_dir.is_dir():
            return None
        return sum(_running_by_rollout(tasks_dir, _note_index(tasks_dir)).values())
    except reraise:
        raise
    except Exception:  # noqa: BLE001 — a count for the record only: never a failure of the suite it describes
        return None


def _running_by_rollout(tasks_dir: Path, index, exclude=None, leases=None, lapsed=None) -> dict:
    """{<rollout stem>: n} for every open, started, parallel Rollout on the Mac running n > 0 tasks whose lead's lease
    has not lapsed, sorted, but the rollout note `exclude` names (execute away.md § The Trickle). `index` is one walk
    of `tasks_dir` (_scan's, or _note_index's). A rollout note counts only when it sits directly in `tasks_dir` (never
    under Archive/), is tagged `rollout`, is not done or dropped, reads parallel, carries no `paused:` stamp, is not
    `exclude`, and has started (never_started over the index notes whose `rollout:` names it). Its n is those notes at
    `status: in_progress`, less the ones its own undecided RACE or UNVERIFIED holds (_race_holds): such a task never
    restarts, so it holds no Slot. Review and integrating notes never count (Integration holds no Slot), nor does a
    serial rollout's Leg. Each n is _counted_running's, the count `status` reads for its own rollout too
    (_counted_by_rollout's sets). Then the lease (p28-4): a rollout with n > 0 whose lease reads lapsed (`leases`, a
    _Leases; by default one at the clock's now) is left out, and put in `lapsed` instead when a dict is given (sorted
    in place); no lease file, an unreadable one or a standing room stop still counts."""
    this = exclude.resolve() if exclude is not None else None
    if leases is None:
        leases = _Leases(datetime.now().astimezone())
    out, left = {}, {}
    for path, note, counted in _counted_by_rollout(tasks_dir, index).values():
        if counted and (this is None or path.resolve() != this):
            if leases.counts(path.stem, note):
                out[path.stem] = len(counted)
            else:
                left[path.stem] = len(counted)
    if lapsed is not None:
        lapsed.clear()
        lapsed.update(sorted(left.items()))
    return dict(sorted(out.items()))


def _counted_by_rollout(tasks_dir: Path, index) -> dict:
    """{<stem, lowercased>: (path, Note, {<counted slug, lowercased>})} for every note directly in `tasks_dir` (never
    under Archive/), each set _counted_tasks' over the index notes whose `rollout:` names that note (empty for a note
    that is no countable rollout). `index` is one walk of `tasks_dir`. Read by _running_by_rollout for its counts and
    by _trickle_claims_judge, which consumes a Trickle claim once its task is in its rollout's set. No lease is read
    here (p28-4): _running_by_rollout applies it to the counts, and a claim is consumed whatever its rollout's lease."""
    by_rollout = {}
    for path, note in index.values():
        target = (_wikilink_slug(note.get("rollout")) or "").lower()
        if target:
            by_rollout.setdefault(target, []).append((path, note))
    return {path.stem.lower(): (path, note, set(_counted_tasks(note, by_rollout.get(path.stem.lower(), []))))
            for path, note in index.values() if path.parent == tasks_dir}


def _trickle_eligible(note) -> bool:
    """A rollout note the Mac-wide count reads at all (_counted_tasks' first gate; the caller checks it sits directly
    in `tasks_dir`): tagged `rollout`, not done or dropped, parallel, and carrying no `paused:` stamp."""
    if "rollout" not in _tags(note) or _status(note) in CLOSED_ROLLOUT_STATUSES:
        return False
    return _shape(note) == "parallel" and not _valued(note.get("paused"))


def _counted_tasks(note, linked) -> list:
    """The tasks a rollout note runs as the Mac-wide count reads them, one lowercased slug per counted note in
    `linked` order: none unless it is _trickle_eligible and has started (never_started over `linked`, the notes whose
    `rollout:` names it); else its `status: in_progress` notes less the ones its own undecided RACE or UNVERIFIED
    holds (_race_holds)."""
    if not _trickle_eligible(note) or never_started(note, linked)[0]:
        return []
    held = _race_holds(note, linked)
    return [p.stem.lower() for p, t in linked if _status(t) == "in_progress" and p.stem.lower() not in held]


def _counted_running(note, linked) -> int:
    """The number of tasks a rollout note runs as the Mac-wide count reads them (_counted_tasks). Read by `status` for
    its own rollout (the Trickle line's `here`); every other rollout's n (_elsewhere_running's and mac_running's count)
    is the same count, through _counted_by_rollout, which also checks the note sits directly in `tasks_dir`. The
    lease is never read here: each caller applies it (p28-4), _running_by_rollout to every rollout with n > 0 and
    `status` to its own `here`."""
    return len(_counted_tasks(note, linked))


# ---- the Trickle claims (p28-3; execute away.md § The Trickle, *Trickle claims*) -----------------------------------

def _trickle_paths():
    """(the trickle claim lock, the Trickle claims file): TRICKLE_LOCK and TRICKLE_CLAIMS in the note-lock dir
    (_note_lock_dir), outside the vault, the one dir every lead on the Mac resolves alike."""
    base = _note_lock_dir()
    return base / TRICKLE_LOCK, base / TRICKLE_CLAIMS


def _trickle_claims_read(path):
    """The Trickle claims file, read whole: (claims, waiting, why, writable). Missing (no file, or no dir): ([], [],
    None, True), silently. Unreadable (any other OSError, over TRICKLE_CLAIMS_MAX_BYTES, not UTF-8, not JSON, not an
    object, a `version` that is no integer, or `claims` not a list): ([], [], why, True), so `next` warns and its next
    write replaces it. Another integer version: ([], [], "version <v>", False), so `next` warns, reads it as none and
    never writes it (a later writer's file). Else its `claims` list and its `waiting` list (p28-5) as read, every entry
    still unjudged: an absent `waiting` (a file in p28-3's shape) reads [], and a present one that is no list reads
    None, silently: judged as none, and unequal to any list, so the next write replaces it."""
    try:
        with open(path, "rb") as f:
            raw = f.read(TRICKLE_CLAIMS_MAX_BYTES + 1)
    except FileNotFoundError:
        return [], [], None, True
    except OSError as e:
        return [], [], f"cannot read it ({e.strerror or e})", True
    if len(raw) > TRICKLE_CLAIMS_MAX_BYTES:
        return [], [], f"over {TRICKLE_CLAIMS_MAX_BYTES // 1024} KiB", True
    try:
        data = json.loads(raw.decode("utf-8"))
    except UnicodeDecodeError:
        return [], [], "not UTF-8", True
    except ValueError:
        return [], [], "not JSON", True
    if not isinstance(data, dict):
        return [], [], "not a JSON object", True
    version = data.get("version")
    if type(version) is not int:
        return [], [], "no integer version", True
    if version != TRICKLE_CLAIMS_VERSION:
        return [], [], f"version {version}", False
    if not isinstance(data.get("claims"), list):
        return [], [], "claims is not a list", True
    waiting = data.get("waiting", [])
    return data["claims"], (waiting if isinstance(waiting, list) else None), None, True


def _trickle_claims_judge(entries, tasks_dir: Path, this_stem: str, walk, now, wall):
    """(counted, kept): which Trickle claims count against this call and which the next write keeps (away.md § The
    Trickle, *Trickle claims*). `walk` is the call's index of `tasks_dir`, `now` its clock (--now, else the real one)
    and `wall` always the real clock. Rules, in order, on each entry R/S (its rollout, its task; stems compared
    lowercased):
      1. malformed (no object, a key missing or no non-empty string, an `at` _parse_ts reads as None, a naive one
         that cannot be placed in local time included): dropped, never a crash no later write could prune;
      2. another tasksDir: never counted, kept only while under TRICKLE_CLAIM_TTL old by `wall` (so a test's --now
         never ages a real claim);
      3. this rollout's own: dropped (this call's starts replace them); so is a repeat of an entry already judged;
      4. TRICKLE_CLAIM_TTL old or older by `now` (or as far ahead of it): dropped;
      5. R in the walk but outside the count (not directly in `tasks_dir`, or not _trickle_eligible): dropped;
      6. R's counted set: _counted_by_rollout's for a present R, empty for an R the walk lacks (torn mid-edit, or
         deleted), so a claim is never consumed through a note the walk could not read;
      7. S in the walk: dropped when its `rollout:` names another rollout (carried) or it is neither queued nor
         running (it left the queue another way), and consumed (dropped) once running and in R's counted set, the
         note-based count now counting it; else counted and kept;
      8. S not in the walk (deleted, or torn mid-edit): counted and kept.
    `counted` is {<rollout>: n}: a present R under its walked stem (_elsewhere_running's key), an absent one under the
    stem the claim recorded (stems equal when lowercased spelled as the first in sorted order). `kept` holds the four
    keys only."""
    here = os.path.realpath(str(tasks_dir))
    this = this_stem.lower()
    counted_by = _counted_by_rollout(tasks_dir, walk)
    counted, absent, kept, seen = {}, {}, [], set()
    for e in entries:
        if not isinstance(e, dict) or not all(isinstance(e.get(k), str) and e.get(k) for k in TRICKLE_CLAIM_KEYS):
            continue
        at = _parse_ts(e["at"])
        if at is None:
            continue
        e = {k: e[k] for k in TRICKLE_CLAIM_KEYS}
        if e["tasksDir"] != here:
            if abs(wall - at) < TRICKLE_CLAIM_TTL:
                kept.append(e)
            continue
        r, s = e["rollout"].lower(), e["slug"].lower()
        if r == this or (r, s) in seen or abs(now - at) >= TRICKLE_CLAIM_TTL:
            continue
        ro = walk.get(r)
        if ro is not None and (ro[0].parent != tasks_dir or not _trickle_eligible(ro[1])):
            continue
        done = counted_by.get(r, (None, None, set()))[2] if ro is not None else set()
        task = walk.get(s)
        if task is not None:
            if (_wikilink_slug(task[1].get("rollout")) or "").lower() != r:
                continue
            state = _queue_state(task[1])[0]
            if state not in ("queued", "running") or (state == "running" and s in done):
                continue
        seen.add((r, s))
        kept.append(e)
        if ro is not None:
            counted[ro[0].stem] = counted.get(ro[0].stem, 0) + 1
        else:
            absent.setdefault(r, []).append(e["rollout"])
    for spellings in absent.values():
        counted[min(spellings)] = len(spellings)
    return counted, kept


def _trickle_merge(notes, claims) -> dict:
    """The count elsewhere `next` reads: the notes' (_elsewhere_running) plus the claims' (_trickle_claims_judge), per
    rollout, n > 0 only, sorted."""
    out = dict(notes)
    for key, n in claims.items():
        out[key] = out.get(key, 0) + n
    return dict(sorted((k, n) for k, n in out.items() if n > 0))


def _wait_ts(dt) -> str:
    """A waiting record's time (p28-5): local, to the second, with its offset, as a claim's `at` is written."""
    return dt.astimezone().isoformat(timespec="seconds")


def _latest_started(rows):
    """The latest `started:` stamp _parse_ts reads among a rollout's rows, or None (never served). The § 4 stamp's
    first start wins, so a restart or a seeded revise never moves it (p28-5: a waiting record's `served` is the later of
    this and its own earlier record's, so a start no record saw still counts)."""
    return max((t for t in (_parse_ts(r["started"]) for r in rows) if t is not None), default=None)


def _seeded_revises(set_aside, task_held, rollout_note, root):
    """The set-aside rows execute § 4.5 step 1.2 launches as a seeded revise, in rank order (p28-5: the fair share counts
    them in this rollout's demand and its waiting record's `want`, away.md § The Trickle, *A fair share*). Each is read as
    step 1.2 reads it: set aside at `run`, `blocked`, no task hold_until standing (`task_held`), lead-integrate.py's
    `inputs` with autoRevise true under the max_review_rounds a call resolves (_resolved_cap: the task's, the rollout's,
    then rollout-settings.py) and a pr: the engine takes (prUrlError empty, read against the Project root `root`, the
    lead's `inputs --repo <repoPath>`), and no recorded answer (_answer_recorded). A row it cannot judge (lead-integrate.py
    would not load, a round budget that does not resolve, any error reading it) is none: it contends as no revise does,
    so the read fails open and never fails the call. The shape is read before the round budget, so a blocked row that
    is no revise never resolves one."""
    out = []
    for r in sorted(set_aside, key=_rank):
        if r["setAsideAt"] != "run" or r["status"] != "blocked" or r["slug"].lower() in task_held:
            continue
        try:
            lead = _lead()
            inp = lead.task_inputs(r["path"], r["note"], repo=str(root) if root is not None else None)
            if not lead._revise_shaped(inp) or inp["prUrlError"]:
                continue
            k, _why = _resolved_cap(r["note"], rollout_note, "max_review_rounds")
            if k is not None and inp["lastRound"] < k and _answer_recorded(r["note"]) is None:
                out.append(r)
        except Exception:  # noqa: BLE001 — the fair share's read only: a row it cannot judge is no revise
            continue
    return out


def _trickle_waiting_judge(entries, tasks_dir: Path, this_stem: str, walk, now, wall):
    """(live, kept, own): which waiting records (p28-5; away.md § The Trickle, *A fair share*) the fair share reads,
    which the next write keeps, and this rollout's own. `walk` is the call's index of `tasks_dir`, `now` its clock
    (--now, else the real one) and `wall` always the real clock. Rules, in order, on each record R (its rollout; stems
    compared lowercased):
      1. malformed: dropped silently, never a crash no later write could prune. That is: no object; a key of
         TRICKLE_WAIT_KEYS missing; `tasksDir`, `rollout`, `since` or `at` no non-empty string; `since` or `at` that
         _parse_ts reads as None (a naive one that cannot be placed in local time included); `served` neither null
         nor such a string; `want` no int >= 1 (a bool is none); `since` or `served` after `at`;
      2. another tasksDir: never counted, kept only while under TRICKLE_WAIT_TTL old by `wall` (so a test's --now
         never ages a real record);
      3. TRICKLE_WAIT_TTL old or older by `now`, or as far ahead of it: dropped. This runs before step 5, so a lapsed
         or future own record is never read: its `since` and `served` are never carried forward;
      4. repeats (one lowercased R): the latest `at` wins, and on equal `at` the first in file order;
      5. this rollout's own: removed (this call's record replaces it) and returned as `own` {since, served}, the only
         way a `since` or a `served` carries forward; `own` is None when no own record passed steps 1-4;
      6. R in the walk but outside the count (not directly in `tasks_dir`, or not _trickle_eligible: paused, closed,
         serial, untagged): dropped. A never-started rollout stays: a morning launch waits like any other;
      7. R not in the walk (torn mid-edit, or deleted): live until the TTL, under the spelling it recorded.
    `live` is {<R lowercased>: {name, since, served, want}}, `name` the walked note's stem when present, else the
    recorded spelling, `since` and `served` aware datetimes (`served` None when never served). `kept` holds the six
    keys only."""
    here = os.path.realpath(str(tasks_dir))
    this = this_stem.lower()
    kept, best = [], {}
    for i, e in enumerate(entries):
        if not isinstance(e, dict) or not all(k in e for k in TRICKLE_WAIT_KEYS) or \
                not all(isinstance(e[k], str) and e[k] for k in ("tasksDir", "rollout", "since", "at")):
            continue
        since, at, want = _parse_ts(e["since"]), _parse_ts(e["at"]), e["want"]
        served = _parse_ts(e["served"]) if isinstance(e["served"], str) else None
        if since is None or at is None or (e["served"] is not None and served is None) or \
                type(want) is not int or want < 1 or since > at or (served is not None and served > at):
            continue
        e = {k: e[k] for k in TRICKLE_WAIT_KEYS}
        if e["tasksDir"] != here:
            if abs(wall - at) < TRICKLE_WAIT_TTL:
                kept.append(e)
            continue
        if abs(now - at) >= TRICKLE_WAIT_TTL:
            continue
        key = e["rollout"].lower()
        if key not in best or at > best[key][1]:
            best[key] = (i, at, e, since, served, want)
    live, own = {}, None
    for key, (_i, _at, e, since, served, want) in sorted(best.items(), key=lambda kv: kv[1][0]):
        if key == this:
            own = {"since": since, "served": served}
            continue
        ro = walk.get(key)
        if ro is not None and (ro[0].parent != tasks_dir or not _trickle_eligible(ro[1])):
            continue
        live[key] = {"name": ro[0].stem if ro is not None else e["rollout"], "since": since, "served": served,
                     "want": want}
        kept.append(e)
    return live, kept, own


def _fair_share(free: int, contenders, now) -> dict:
    """{<name>: n}: how a fair share (p28-5; away.md § The Trickle, *A fair share*) gives `free` places out among
    `contenders`, each {name, held, served, since, demand} (`served` None when never served). One place at a time, each
    to the contender whose demand is still unmet with the lowest (held, served, since, name lowercased), a never-served
    one first; the winner then holds one more and reads served `now` for the next place. Places no unmet demand takes
    go to nobody. n > 0 only, sorted. Pure: cmd_next puts this rollout among the contenders and keeps for waiting
    rollouts the places the others win."""
    pool = [dict(c, got=0) for c in contenders]
    for _ in range(max(0, free)):
        unmet = [c for c in pool if c["got"] < c["demand"]]
        if not unmet:
            break
        c = min(unmet, key=lambda c: (c["held"], (0,) if c["served"] is None else (1, c["served"]), c["since"],
                                      c["name"].lower()))
        c["got"], c["held"], c["served"] = c["got"] + 1, c["held"] + 1, now
    return dict(sorted((c["name"], c["got"]) for c in pool if c["got"] > 0))


def _trickle_claims_write(path: Path, claims, waiting):
    """Write the Trickle claims file whole, {"version": 1, "claims": [...], "waiting": [...]}: a temp file beside it
    (TRICKLE_CLAIMS.<pid>.tmp), fsynced, then renamed over it, so no reader sees half a file. None, or why it could not
    (an OSError; nothing is left behind)."""
    tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"version": TRICKLE_CLAIMS_VERSION, "claims": claims, "waiting": waiting}, f, indent=1)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except OSError as e:
        return str(e)
    finally:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
    return None


def _project(note):
    """The first `projects:` link's slug, as written, or None (the rollout's project for the last starts' history and
    the incomplete refusal's remedy)."""
    return next((s for s in (_wikilink_slug(v) for v in note.get_list("projects")) if s), None)


def _kind(note) -> str:
    """A task's kind for the last starts (Chorus ADR 0099 d2's reading; execute away.md § The last starts): its note's
    `scope:` as _scope reads it, else UNSCOPED_KIND."""
    return _scope(note) or UNSCOPED_KIND


def _morning_toward(away, now):
    """M, the Morning the last starts look toward (execute away.md § The last starts), or None when they do not apply.
    They apply only while a fresh file reads Away to the Morning: `until`, read in local wall-clock time (the Mac's
    zone, as `morning` is), falls on `morning`'s HH:MM to the minute, and now < M <= now + LAST_START_HORIZON. M is that
    `until` with its seconds cut: the same instant, at the local offset (`until.astimezone()`), so a daylight-saving
    night needs no wall-clock arithmetic. A Lunch restart or a daytime Away block (an `until` off the Morning), a block
    ending before or spanning it, and a Morning more than 24 h out are no night: None."""
    if not away["away"] or away["file"] != "fresh":
        return None
    until = _away_stamp(away["until"])[0]
    if until is None:
        return None
    u = until.astimezone()
    if u.strftime("%H:%M") != away["morning"]:
        return None
    m = u.replace(second=0, microsecond=0)
    return m if now < m <= now + LAST_START_HORIZON else None


def _is_count(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _past_runs(project, rollout_path: Path, rollout_note, index, now) -> dict:
    """{kind: [durationMs, ...]}: the past runs the last starts read (Chorus ADR 0099 d2's reading; execute away.md § The
    last starts), from the folded call journals in every per-rollout `<stem>.jsonl` of the events dir, never a RESERVED
    file. A file counts only when its rollout note names `project` first in its `projects:` (case ignored): this
    rollout's own note for its own record, else the note `index` (_scan's: Archive/Rollouts included) holds for the
    stem. A call counts when its latest terminal call-journal line reads `status: completed` and `mode: task`, with an
    int durationMs >= 1 and an int startTime, its end (startTime + durationMs) in [now - LAST_START_HISTORY, now], a
    run-bound line for its runId in the same file and none carrying `resumedFrom`; each runId counts once. Its kind is
    its task note's (_kind, the note in `index`); a call with no note is skipped. No project, or an events dir, file or
    line that cannot be read, reads fewer runs, so the fallback holds more, never less."""
    out = {}
    if not project:
        return out
    want = project.lower()
    try:
        rr = _run_record()
        base = rr.events_dir()
        names = sorted(os.listdir(base))
    except Exception:
        return out
    this = rollout_path.stem.lower()
    now_ms = now.timestamp() * 1000
    lo_ms = now_ms - LAST_START_HISTORY.total_seconds() * 1000
    seen = set()
    for name in names:
        stem = name[:-len(".jsonl")] if name.endswith(".jsonl") else ""
        if not stem or stem in rr.RESERVED:
            continue
        note = rollout_note if stem == this else (index.get(stem) or (None, None))[1]
        if note is None or (_project(note) or "").lower() != want:
            continue
        try:
            lines, _bad = _record_lines(os.path.join(base, name))
        except OSError:
            continue
        bound, resumed, final = set(), set(), {}
        for d in lines:
            run_id = d.get("runId")
            if not isinstance(run_id, str):
                continue
            if d.get("kind") == "run-bound":
                bound.add(run_id)
                if d.get("resumedFrom") is not None:
                    resumed.add(run_id)
            elif d.get("kind") == "call-journal" and d.get("status") in rr.TERMINAL_STATUSES:
                final[run_id] = d  # the latest terminal line per runId (run_record.py's reader rule)
        for run_id, d in final.items():
            if run_id in seen or run_id not in bound or run_id in resumed:
                continue
            ms, start, task = d.get("durationMs"), d.get("startTime"), d.get("task")
            if d.get("status") != "completed" or d.get("mode") != "task" or not isinstance(task, str):
                continue
            if not (_is_count(ms) and ms >= 1 and _is_count(start) and lo_ms <= start + ms <= now_ms):
                continue
            entry = index.get(task.lower())
            if entry is None:
                continue
            seen.add(run_id)
            out.setdefault(_kind(entry[1]), []).append(ms)
    return out


def _usual(lengths):
    """(median, k) of one kind's past run lengths in ms: the median is None under LAST_START_MIN_RUNS (no history)."""
    k = len(lengths)
    return (statistics.median(lengths) if k >= LAST_START_MIN_RUNS else None), k


class _LastStarts:
    """One `next` call's last starts (execute away.md § The last starts): M (`morning`, None when they do not apply),
    the past runs read lazily once (`runs`, a zero-argument callable: only a start candidate reaching the check or a due
    ran-past line reads them), and each kind this call's candidates read (`lastStarts.kinds`)."""

    def __init__(self, morning, hhmm, now, runs):
        self.morning, self.hhmm, self.now, self._runs, self._read, self.kinds = morning, hhmm, now, runs, None, {}

    def reading(self, kind):
        """(median ms or None, k) for `kind`, the past runs read on first use."""
        if self._read is None:
            self._read = self._runs()
        return _usual(self._read.get(kind, []))

    def fields(self, kind) -> dict:
        """A night line's {scope, history, usualMinutes?}: the kind's reading now."""
        median, k = self.reading(kind)
        out = {"scope": kind, "history": k}
        if median is not None:
            out["usualMinutes"] = math.ceil(median / 60000)
        return out

    def hold(self, row):
        """The `last start:` reason that holds this start, or None (it ends by M, or the last starts do not apply). A
        start is held when now + its kind's usual length (with no history, LAST_START_FALLBACK) is past M, so one that
        ends exactly at M starts. Quote-free, so it can ride a ROLLOUT-STATUS reason."""
        if self.morning is None:
            return None
        kind = _kind(row["note"])
        median, k = self.reading(kind)
        self.kinds[kind] = {"usualMinutes": None if median is None else math.ceil(median / 60000), "history": k}
        if median is None:
            if self.now + LAST_START_FALLBACK <= self.morning:
                return None
            hours = int(LAST_START_FALLBACK.total_seconds() // 3600)
            return (f"{LAST_START_PREFIX} no history for {kind} ({k} past runs, {LAST_START_MIN_RUNS} needed), none "
                    f"starts in the {hours} h before the Morning at {self.hhmm}")
        if self.now + timedelta(milliseconds=median) <= self.morning:
            return None
        return (f"{LAST_START_PREFIX} {kind} usually takes {math.ceil(median / 60000)} min (median of {k} past runs), "
                f"past the Morning at {self.hhmm}")

    def output(self) -> dict:
        return {"morning": None if self.morning is None else self.morning.isoformat(),
                "kinds": dict(sorted(self.kinds.items()))}


def _utc_z(dt, ms=False) -> str:
    """A night line's stamp: UTC with a `Z`, to the second (the `morning` key), or to the millisecond as run_record.py
    stamps `ts` (slotTakenAt)."""
    u = dt.astimezone(timezone.utc)
    return u.strftime("%Y-%m-%dT%H:%M:%S") + (".%03dZ" % (u.microsecond // 1000) if ms else "Z")


def _record_night(rollout):
    """(state, why): this rollout's Run record replayed for the night record (execute away.md § The night record).
    state is {markers: {M}, held: {(task, M)}, ran: {(task, M)}, slots: {task: [(taken, freed)]}}: the Morning of
    each away-night, last-start-held and ran-past-morning line (aware datetimes; tasks lowercased as the writer stores
    them), and each task's Slot intervals by _record_state's pairing rules plus ts: a slot-taken while that task's Slot
    is open is the same Slot (the first ts kept), a slot-freed or a from-file `carried` closes it at its ts, one with
    nothing open is ignored, and a Slot still open at the record's last line has freed None. A line whose ts or
    morning does not parse is skipped. No file is an empty record; (None, why) when it cannot be read."""
    try:
        path = _run_record().record_path(rollout)
    except Exception as e:
        return None, f"cannot resolve the record: {e}"
    st = {"markers": set(), "held": set(), "ran": set(), "slots": {}}
    try:
        lines, _bad = _record_lines(path)
    except FileNotFoundError:
        return st, None
    except OSError as e:
        return None, f"cannot read {path}: {e.strerror or e}"
    open_slots = {}
    for d in lines:
        kind, task = d.get("kind"), d.get("task")
        if kind in NIGHT_KINDS:
            m = _away_stamp(d.get("morning"))[0]
            if m is None:
                continue
            if kind == "away-night":
                st["markers"].add(m)
            elif isinstance(task, str):
                st["held" if kind == "last-start-held" else "ran"].add((task, m))
            continue
        ts = _away_stamp(d.get("ts"))[0]
        if ts is None or not isinstance(task, str):
            continue
        if kind == "slot-taken":
            open_slots.setdefault(task, ts)
        elif (kind == "slot-freed" or (kind == "carried" and d.get("rollout") == d.get("from"))) and task in open_slots:
            st["slots"].setdefault(task, []).append((open_slots.pop(task), ts))
    for task, taken in open_slots.items():
        st["slots"].setdefault(task, []).append((taken, None))
    return st, None


def _night_record(rollout, last, holds, index, now, args):
    """The night record's writes for one `next` call off --dry-run, after idle-slots (execute away.md § The night
    record), each best-effort through _event and checked against this rollout's record (_record_night) so a rerun adds
    nothing: one away-night {morning} per (rollout, M) while the last starts apply; one last-start-held {morning,
    scope, history, usualMinutes?} per (task, M) for each final hold that reads `last start:` (after the git-env
    override, so a git-env or pause hold writes none); and, for every marker whose M <= now, one ran-past-morning
    {morning, slotTakenAt, scope, history, usualMinutes?} per (task, M) for each task whose Slot was open at M (taken
    before it, not freed at or before it), read from the record's Slot intervals, never from notes, so a Morning the
    lead missed is recorded at its next call. scope is the task note's kind (UNSCOPED_KIND with no note), history and
    usualMinutes its reading now. An unreadable record writes no night line: one `run_record: warning: night record not
    written: <why>` line while the last starts apply, else silence."""
    st, why = _record_night(rollout)
    morning = last.morning
    if st is None:
        if morning is not None:
            print(f"run_record: warning: night record not written: {why}", file=sys.stderr)
        return
    if morning is not None:
        mz = _utc_z(morning)
        if morning not in st["markers"]:
            _event(rollout, "away-night", None, {"morning": mz}, args)
        for r, reason in sorted(holds, key=lambda h: _rank(h[0])):
            if reason.startswith(LAST_START_PREFIX) and (r["slug"].lower(), morning) not in st["held"]:
                _event(rollout, "last-start-held", r["slug"], {"morning": mz, **last.fields(_kind(r["note"]))}, args)
    for m in sorted(st["markers"]):
        if m > now:
            continue
        for task in sorted(st["slots"]):
            taken = next((t for t, freed in st["slots"][task] if t < m and (freed is None or freed > m)), None)
            if taken is None or (task, m) in st["ran"]:
                continue
            entry = index.get(task)
            kind = _kind(entry[1]) if entry is not None else UNSCOPED_KIND
            _event(rollout, "ran-past-morning", task,
                   {"morning": _utc_z(m), "slotTakenAt": _utc_z(taken, ms=True), **last.fields(kind)}, args)


# ---- hold until (p30-3; vault-grammar § Hold until) ---------------------------------------------------------

HOLD_REPO_PR_RE = re.compile(r"^([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)#(\d+)$")
HOLD_PAIR_RE = re.compile(r"^([^:\s][^:]*?)\s*:(?:[ \t]+(.*))?$")
HOLD_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_-]*$")
HOLD_NOT_MAPPING = "not a {pr, merged} mapping"


def _yaml_uncomment(raw: str) -> str:
    """A YAML value without its comment, stripped: a `#` at the start or after whitespace, outside quotes, opens one, so
    an unquoted ` #7` is a comment and a quoted `"#7"` is a value."""
    quote = None
    for i, ch in enumerate(raw):
        if quote:
            if ch == quote:
                quote = None
        elif ch in "\"'":
            quote = ch
        elif ch == "#" and (i == 0 or raw[i - 1] in " \t"):
            return raw[:i].strip()
    return raw.strip()


def _yaml_unquote(value: str) -> str:
    v = value.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1].strip()
    return v


def _flow_items(inner: str):
    """A flow mapping's inside split at the commas outside quotes."""
    parts, cur, quote = [], "", None
    for ch in inner:
        if quote:
            quote = None if ch == quote else quote
        elif ch in "\"'":
            quote = ch
        elif ch == ",":
            parts.append(cur)
            cur = ""
            continue
        cur += ch
    return parts + [cur]


def _hold_until(note, project_root):
    """A note's PR hold (vault-grammar § Hold until), or None when its frontmatter has no top-level `hold_until:` line.
    Two forms read: the flow `hold_until: {pr: <pr>, merged: true}` (an optional trailing ` # comment`) and the block
    form Obsidian re-serialises it to (`hold_until:` then indented `pr:` and `merged:` lines). `pr` is required:
    `owner/repo#N` (read through its URL, `https://github.com/owner/repo/pull/N`: gh takes no `owner/repo#N`), a PR URL
    (run as written) or a bare `N` / quoted `"#N"` (run in the Project root, `project_root`, as `resume` runs one).
    `merged` is optional, true by default; any other value is unreadable, and so is an empty value, `null`, an unknown
    or repeated key, a missing pr, a pr of no form above and a bare number with no Project root directory.
    Returns {pr (as written, quotes stripped), url, error (why it is unreadable, from a fixed set, quote-free), argv
    (gh's), cwd, key (the memo key: the canonical URL, or ("root", N)), merged, lines (the block, verbatim)}: a hold with
    an error makes no gh call and never clears itself (fail closed)."""
    lines = note.fm_block(HOLD_KEY)
    if lines is None:
        return None
    out = {"pr": None, "url": None, "error": None, "argv": None, "cwd": None, "key": None, "merged": None,
           "lines": lines}

    def fail(why):
        out["error"] = why
        return out

    value = _yaml_uncomment(lines[0][len(HOLD_KEY) + 1:])
    if value.lower() in ("null", "~"):
        return fail("null value")
    if value:
        text = " ".join([value] + [_yaml_uncomment(line) for line in lines[1:]]).strip()
        if not (text.startswith("{") and text.endswith("}")):
            return fail(HOLD_NOT_MAPPING)
        items = [i.strip() for i in _flow_items(text[1:-1]) if i.strip()]
    else:
        items = [i for i in (_yaml_uncomment(line) for line in lines[1:]) if i]
        if not items:
            return fail("empty value")
    fields = {}
    for item in items:
        m = HOLD_PAIR_RE.match(item)
        if not m or not HOLD_NAME_RE.match(m.group(1)):
            return fail(HOLD_NOT_MAPPING)
        k = m.group(1)
        if k not in HOLD_FIELDS:
            return fail(f"unknown key {k}")
        if k in fields:
            return fail(f"duplicate key {k}")
        fields[k] = _yaml_unquote(m.group(2) or "")
    merged = fields.get("merged")
    out["merged"] = "true" if merged is None else merged
    pr = fields.get("pr") or ""
    if not pr or pr.lower() in ("null", "~"):
        return fail("no pr")
    out["pr"] = pr
    if merged is not None and merged.lower() != "true":
        return fail("merged must be true")
    view = ["--json", "state,mergedAt,url"]
    repo_pr, url, num = HOLD_REPO_PR_RE.match(pr), PR_URL_RE.match(pr), PR_NUM_RE.match(pr)
    if repo_pr:
        canonical = f"https://github.com/{repo_pr.group(1)}/pull/{repo_pr.group(2)}"
        out.update(url=canonical, argv=["pr", "view", canonical, *view], key=canonical)
    elif url:
        out.update(url=pr, argv=["pr", "view", pr, *view], key=f"https://github.com/{url.group(1)}/pull/{url.group(2)}")
    elif num:
        if project_root is None or not project_root.is_dir():
            return fail("a bare PR number and no Project root")
        out.update(argv=["pr", "view", num.group(1), *view], cwd=str(project_root), key=("root", num.group(1)))
    else:
        return fail("pr is not owner/repo#N, a PR URL or a PR number")
    return out


def _hold_public(hold):
    """`status`'s view of a parsed hold: {pr, url, error}, or None."""
    return None if hold is None else {"pr": hold["pr"], "url": hold["url"], "error": hold["error"]}


def _resolve_holds(gh_bin, holds, memo):
    """`next`'s reading of each parsed hold, [(entry, reason)] in order: `holds` is [(note stem, scope, hold)], and
    `memo` (one per call of `next`) maps a hold's key to gh's answer, so one PR is read once whatever names it. entry is
    {note, scope, pr, url, state, error, held, waits, cleared}: MERGED releases it (held false, waits null); OPEN or a gh
    error or timeout (HOLD_GH_TIMEOUT) holds and waits on the merge, retried at the next call; CLOSED and an unreadable
    hold (no gh call) hold and wait on Lachy (`you`). reason is the quote-free hold reason, None once released."""
    out = []
    for stem, scope, hold in holds:
        state, url, err = None, hold["url"], hold["error"]
        if err is None:
            if hold["key"] not in memo:
                raw, gh_err = _gh(gh_bin, hold["argv"], hold["cwd"], timeout=HOLD_GH_TIMEOUT)
                info = {}
                if gh_err is None:
                    try:
                        info = json.loads(raw)
                    except ValueError:
                        info = None
                    if not isinstance(info, dict):
                        info, gh_err = {}, "gh pr view printed no JSON"
                    elif not str(info.get("state") or "").strip():
                        gh_err = "gh pr view printed no state"
                memo[hold["key"]] = (str(info.get("state") or "").strip().upper() or None,
                                     info.get("url") if isinstance(info.get("url"), str) else None, gh_err)
            state, gh_url, err = memo[hold["key"]]
            url = url or gh_url
        pr = (hold["pr"] or "").replace('"', "'")
        if hold["error"] is not None:
            reason, waits = f"{HOLD_UNTIL_PREFIX}: {HOLD_KEY} unreadable ({hold['error']})", "you"
        elif err is not None:
            line = err.replace('"', "'")   # quote-free, so it can ride a ROLLOUT-STATUS reason=
            reason, waits = f"{HOLD_UNTIL_PREFIX} {pr} merges (gh: {line})", "merge"
        elif state == "MERGED":
            reason, waits = None, None
        else:
            reason, waits = f"{HOLD_UNTIL_PREFIX} {pr} merges ({state})", "you" if state == "CLOSED" else "merge"
        out.append(({"note": stem, "scope": scope, "pr": hold["pr"], "url": url, "state": state, "error": err,
                     "held": reason is not None, "waits": waits, "cleared": False}, reason))
    return out


def _clear_hold(note, hold, label, dry_run, also=()) -> bool:
    """`next`'s clear of a merged hold off --dry-run: Note.remove_block (a compare-and-swap) and the note's own save.
    True once saved with no `hold_until` left on the note: a hold another writer rewrote since the read stays (the
    swap's replay keeps it), so it reads False and the lead never reports a standing hold cleared. An OSError is one
    stderr WARN line and False, and the hold still releases for this call (the next call retries the clear). `also`:
    the (key, lines) blocks that go with the hold in its swap (an approved queue's `on_merge:` on a plain release)."""
    if dry_run:
        return False
    note.remove_block(HOLD_KEY, hold["lines"], also=also)
    try:
        note.save()
    except OSError as e:
        print(f"WARN: {HOLD_KEY} on {label}: not cleared: {e}", file=sys.stderr)
        return False
    return note.fm_block(HOLD_KEY) is None


# ---- next -------------------------------------------------------------------

def _set_aside_entry(r, hold_reason=None) -> dict:
    """One `next` setAside entry: slug, status, setAsideAt, and `needsHuman` (p16-3) only when the note holds an
    open question, so an entry with none is byte-identical to the pre-p16-3 output. `holdUntil` (p30-3): the reason of
    the task's own hold_until, only while it holds (set aside at `run` or at a gate, read while no rollout hold stands)."""
    entry = {"slug": r["slug"], "status": r["status"], "setAsideAt": r["setAsideAt"]}
    ask = needs_human(r["note"])
    if ask:
        entry["needsHuman"] = ask
    if hold_reason:
        entry["holdUntil"] = hold_reason
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


def _superseded_output(stem, successor, progress) -> dict:
    """`next`'s output on a superseded note (p30-4's backstop): halt "superseded" and supersededBy, the progress line,
    and every other key of the usual output at its empty value, in the usual order."""
    return {"rollout": stem, "ceiling": None, "slotsInUse": 0, "slotLimit": 0, "trickle": None, "lastStarts": None,
            "heat": None, "start": [], "restart": [], "hold": [], "running": [], "awaitingIntegration": [],
            "integrating": [], "setAside": [], "raceHold": [], "gitEnvHold": [], "laneHold": [], "mainRed": [],
            "holdUntil": [], "onMerge": None, "supersededBy": successor, "paused": None, "pauseRequested": False,
            "pausedNow": False, "startUnattended": False, "startCleared": False, "halt": "superseded",
            "awaitingSignOff": [], "progress": progress}


def _on_merge_verdict(rollout_path: Path, rollout_note, ro_entry, ro_hold, rows, index, tasks_dir: Path,
                      integrating, race_held_lane):
    """The approved queue's verdict at the gating PR's merge (p30-4; vault-grammar § Approved queue), run by `next` once
    the rollout hold reads MERGED with no error on a note carrying `on_merge:`. Returns (onMerge, reason), onMerge None
    for a plain release; it edits ro_entry in place when the hold must keep standing. The first that applies:
      - the note is done or dropped: a plain release;
      - the value is unreadable: fail closed, held and waiting on Lachy (`waits: you`, error ON_MERGE_BAD);
      - _approved_marks reads `run` (or `integrating` with a stamp no Integration in flight explains): a WARN line and a
        plain release (onMerge action "released");
      - a room stop stands: the hold stays (`waits: room-stop`, action "waits"), decided again at the next call;
      - every task stamped `integrating:` is in flight (integrating or race_held_lane): the hold stays (`waits:
        integration`);
      - no linked member is left after the project filter (_approved_members): a WARN line and a plain release;
      - else the regenerate: the hold stays (`waits: regenerate`, action "regenerate") with its members."""
    om = _on_merge(rollout_note)
    if _status(rollout_note) in CLOSED_ROLLOUT_STATUSES:
        return None, None
    pr = (ro_hold["pr"] or "").replace('"', "'")
    stem = rollout_path.stem

    def hold(waits, reason):
        ro_entry.update(held=True, waits=waits, cleared=False)
        return reason

    if om["error"] is not None:
        ro_entry["error"] = om["error"]
        return None, hold("you", f"{HOLD_UNTIL_PREFIX}: {ON_MERGE_KEY} unreadable ({om['error']})")
    base = {"note": stem, "pr": ro_hold["pr"], "url": ro_entry["url"], "action": None, "members": [], "successor": None,
            "why": None, "detail": None}

    def released(why, detail):
        tail = f" ({detail})" if detail else ""
        print(f"WARN: {ON_MERGE_KEY}: {ON_MERGE_REGENERATE} on {stem} not run: {why}{tail}: released as a plain hold",
              file=sys.stderr)
        return {**base, "action": "released", "why": why, "detail": detail}, None

    kind, detail = _approved_marks(rollout_note, [(r["path"], r["note"]) for r in rows])
    if kind == "integrating":
        flight = {r["slug"].lower() for r in list(integrating) + list(race_held_lane)}
        loose = [s for s in detail if s.lower() not in flight]
        if not loose:
            return ({**base, "action": "waits", "why": "an Integration in flight", "detail": detail},
                    hold("integration", f"{HOLD_UNTIL_PREFIX} {pr} merged: {ON_MERGE_KEY} {ON_MERGE_REGENERATE} waits "
                                        f"for the Integration of [[{detail[0]}]]"))
        note = next(r["note"] for r in rows if r["slug"] == loose[0])
        kind, detail = "run", (f"its task {loose[0]} carries integrating: {_scalar(note.get('integrating'))} with no "
                               "Integration in flight")
    if kind == "run":
        return released("it has run", detail)
    if kind == "room-stop":
        return ({**base, "action": "waits", "why": "a room stop stands", "detail": detail},
                hold("room-stop", f"{HOLD_UNTIL_PREFIX} {pr} merged: {ON_MERGE_KEY} {ON_MERGE_REGENERATE} waits for the "
                                  f"room stop {detail} to end"))
    found = _approved_members(rollout_path, rollout_note, rows, index, tasks_dir)
    if not found["linked"]:
        return released("nothing of its own left", None)
    return ({**base, "action": "regenerate", "members": found["members"], "successor": found["successor"]},
            hold("regenerate", f"{HOLD_UNTIL_PREFIX} {pr} merged: {ON_MERGE_KEY} {ON_MERGE_REGENERATE}"))


def cmd_next(args) -> int:
    """Which tasks start now (ADR 0030 decision 1). A function of the notes and the Trickle claims file (away.md § The
    Trickle, *Trickle claims*), except for its writes off --dry-run: two to the rollout note (a drained soft pause is
    stamped (`paused:`) here, and once the refusals pass the rollout start stamp (`start: unattended`, _clear_start) is
    removed (`startCleared`); one call can make both) and the claims file, written under the trickle claim lock from a
    fresh walk once the rollout note's save has succeeded: one claim per start, and its waiting record (p28-5) while a
    row waits on the Mac-wide cap or the heat or a seeded revise waits on slotLimit, this rollout's earlier ones
    replaced.
    A claims file it cannot read, a lock it cannot take or a write that fails prints one TRICKLE_WARN line and never
    fails the call (the count then reads the file without the lock, and nothing is claimed). New starts are
    picked greedily by `priority:`, then least file overlap with what is in flight, then schedule rank, among the
    queued tasks ranked above the head Solo task (the first queued Solo task by rank whose dependencies are met,
    p17-2); that task holds every task ranked below it, whatever their
    `priority:` (each held `behind solo [[<head>]]`, a full ceiling included: only the head and the rows above it
    wait on `ceiling:`), and starts only when nothing else has started. A task an undecided RACE or UNVERIFIED holds
    (_race_holds) and that has not landed is re-read as set-aside at `race`: it never starts, restarts or
    integrates, is never a seeded revise (those are set aside at `run`), and its dependants wait. One whose
    `integrating:` stamp stands (the lead's RACE re-verify or revert holds the lane on it) still counts as integrating
    everywhere else: a soft pause is not stamped past it, a solo waits for it and its files count as in flight.
    `raceHold` lists each, in rank order, with its kind; the counts and the progress line are the re-read rows'.
    `awaitingIntegration` is the Integration queue's order: a task a queued task depends on, directly or through a
    folded member (`merged_into:`), first, then the oldest `ready:`, then schedule order (_lane_key). An unacked
    git-env trip (_git_env_hold) is listed under `gitEnvHold` with its scope (ADR 0046): while a whole-rollout one
    (a bare checkout) stands nothing starts or restarts, every stalled or queued task is held (`git-env hold:
    /thread:repair`) and `halt` is "git-env", ahead of every other verdict; a lane one holds the Integration lane
    only. `laneHold` lists what holds the lane (every unacked trip's slug, then each undecided RACE not reverted, or
    whose revert is pending, `revert: true`, or reverted with `main not re-verified`, then each unacked `## Lane log`
    hold, ADR 0048, which stops the lane as a git-env trip does, a pending revert included), and `mainRed` the RACE reverts
    that did not land (_main_red): while one stands nothing starts or restarts, every stalled or queued task is held
    (`main red: …`) and `halt` is "race" at once. Once nothing starts, restarts or runs, no cap, last-start or heat
    hold stands and the lane does not move, a lane `git-env` entry halts "git-env", a `race` entry with `revert:
    false` halts "race" and a `lane` entry halts "lane", ahead of the other verdicts. The Trickle and the Away cap (Chorus ADR
    0104; ADR 0049; execute away.md): once the refusals pass, the Away state file is read (_away_state; a stale or
    unreadable one prints one AWAY_WARN line on stderr) and every other started parallel Rollout's running tasks are
    counted (_elsewhere_running), but a rollout whose lead's lease has lapsed (_Leases; p28-4), which `trickle.lapsed`
    names instead, plus every other lead's live Trickle claims (_trickle_claims_judge), whatever that lead's lease.
    Off --dry-run, right after the refusals, the call rewrites this rollout's own lease (_lease_write; a failure prints
    one LEASE_WARN line). `slotLimit` is min(ceiling, max(0, cap - the count elsewhere - the places kept)), the cap the
    Trickle not Away and the Away cap Away, the places kept those the fair share (_fair_share, p28-5) keeps for waiting
    rollouts (_trickle_waiting_judge), which `trickle.kept` reports. Starts and the head Solo's lone start stop at
    `slotLimit`, counting every in_progress row of this rollout, live or stalled, as the count elsewhere does; a
    restart stops at the ceiling only, since every other lead already counts the task it takes back. A running call is
    never stopped, so `slotsInUse` may exceed `slotLimit`. A row held for want of a Slot reads `ceiling: …` once this
    rollout fills its ceiling, else `trickle: <trickle.running>/<Trickle> tasks running on this Mac` (not Away) or
    `away cap: <trickle.running>/<Away cap> tasks running on this Mac` (Away), either followed by `, <k> kept for
    [[<rollout>]], …` while the fair share keeps places, and neither hold ever lets the rollout halt. This rollout's
    demand in the fair share counts the seeded revises step 1.2 launches (_seeded_revises), and off --dry-run the
    claims write also records it waiting while a row waits on the Mac-wide cap or the heat, or such a revise waits on
    slotLimit (the module docstring's "The fair share"). The last starts (Chorus ADR
    0104 d4; execute away.md): while Away runs to the Morning (_morning_toward), a start or a head Solo's lone start
    that has its Slot (under the Away cap's `slotLimit`) is held (`last start: …`, skipped, never a stop) when its
    kind's usual length would end it past the Morning, `lastStarts` reports it, a `last start:` hold never lets the
    rollout halt either, and off --dry-run the night record follows idle-slots (_night_record). A PR hold (_hold_until;
    the module docstring's "Hold until") is read through `--gh-bin` (_resolve_holds, memoised for the call): the
    rollout's whenever its note carries one, a task's only while no pause and no rollout hold stands and the task could
    start or re-enter; a merged one is released and, off --dry-run, cleared (_clear_hold, Note.remove_block), and one
    that stands holds as `holdUntil` says, with `halt: "held"` once nothing else moves. The Heat hold (estate ADR 0009
    d5; away.md § Heat): the heat is read once, right after the Away state (_heat_state), and at heavy or worse
    `slotLimit` is 0, Away too; a restart still waits on the ceiling alone. A row it holds reads `heat: the Mac is hot
    (<name>)` (the ceiling, once full, names the hold first; no Slot is found, so the last starts never read it), a
    `heat:` hold never lets the rollout halt either, and `heat` ({level, name}) is reported after `lastStarts`."""
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
    # The superseded backstop (p30-4): a note a supersede closed out (its `superseded_by:`, moved to Archive/Rollouts/ or
    # not yet) has nothing left to run. Exit 0 with halt "superseded" and its successor, every other key empty: no
    # ceiling read, no gh call, no write, no event, so a late heartbeat tick on an approved queue's prior ends quietly.
    successor = _wikilink_slug(_scalar(rollout_note.get("superseded_by"))) if _valued(rollout_note.get("superseded_by")) \
        else None
    if successor:
        rows, _index = _rows(rollout_path, rollout_note, Path(os.path.expanduser(args.tasks_dir)))
        counts = _counts(rows)
        print(json.dumps(_superseded_output(rollout_path.stem, successor,
                                            _progress_line(counts, _timeline(rows, counts, None, now))), indent=2))
        return 0
    ceiling, err = _ceiling(rollout_note)
    if err:
        print(f"ERROR: {rollout_path.stem}: {err}", file=sys.stderr)
        return 1
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    rows, index = _rows(rollout_path, rollout_note, tasks_dir)
    why = incomplete(rollout_path, rollout_note, [(r["path"], r["note"]) for r in rows], index)
    if why:
        project = _project(rollout_note) or "<project>"
        print(f"ERROR: {rollout_path.stem} is incomplete: {why}: never run it as written; supersede it with "
              f"/thread:schedule {project} --regenerate", file=sys.stderr)
        return 1
    # The lead's lease (p28-4; execute away.md § The Trickle): every refusal above returned first, so only a lead's call
    # that runs the rollout renews it, and --dry-run never does. Best-effort: a failure prints one LEASE_WARN line.
    if not args.dry_run:
        _lease_write(rollout_path.stem, now, "next")
    # The start stamp (START_KEY): reported as read at this call; the lead's call (not --dry-run) removes it, since a
    # lead now runs the rollout. Every refusal above returned first, so a refused call leaves it for the Stage.
    start_unattended = _start_unattended(rollout_note)
    start_cleared = False
    # The Trickle and the Away cap (Chorus ADR 0104; ADR 0049; execute away.md), read once the refusals pass, so a
    # refused call never warns. A stale or unreadable file warns on every call, --dry-run included; a missing one is the
    # documented default.
    away = _away_state(now)
    if away["file"] in ("stale", "unreadable"):
        print(f"{AWAY_WARN} {away['file']}: {away['why']} — read as not Away, Trickle {DEFAULT_TRICKLE}",
              file=sys.stderr)
    # The Heat hold (estate ADR 0009 d5; away.md § Heat), read once right after the Away state: at heavy or worse
    # nothing new starts, Away too (heat overnight is still heat). Restarts still wait on the ceiling alone.
    heat = _heat_state()
    # The last starts (Chorus ADR 0104 d4; execute away.md § The last starts): only while Away runs to the Morning. The
    # history is read lazily, once, by the first start candidate that reaches the check or a due ran-past line.
    last = _LastStarts(_morning_toward(away, now), away["morning"], now,
                       lambda: _past_runs(_project(rollout_note), rollout_path, rollout_note, index, now))
    # The PR hold (p30-3; vault-grammar § Hold until): the rollout's own hold_until, read once the refusals pass,
    # whenever the key is present (gh, memoised for this call). No key anywhere: gh is never called.
    root = _project_root(rollout_note)
    hold_memo, hold_entries = {}, []
    ro_hold = _hold_until(rollout_note, root)
    ro_entry, ro_reason = None, None
    if ro_hold is not None:
        (ro_entry, ro_reason), = _resolve_holds(args.gh_bin, [(rollout_path.stem, "rollout", ro_hold)], hold_memo)
        hold_entries.append(ro_entry)
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
    # The approved queue's verdict (p30-4; vault-grammar § Approved queue): a merged rollout hold on a note carrying
    # `on_merge:` releases as usual, or keeps standing to wait (an Integration in flight, a standing room stop), to
    # regenerate, or to wait on Lachy (an unreadable value). While it stands nothing new integrates either.
    on_merge = None
    if ro_entry is not None and ro_entry["state"] == "MERGED" and ro_entry["error"] is None and \
            _on_merge(rollout_note) is not None:
        on_merge, reason = _on_merge_verdict(rollout_path, rollout_note, ro_entry, ro_hold, rows, index, tasks_dir,
                                             integrating, race_held_lane)
        if ro_entry["held"]:
            ro_reason = reason
            awaiting = []
    # A task's own hold_until is read only while no pause and no rollout hold stands, and only on a task this call
    # could start or re-enter: a stalled one, a queued one whose dependencies are met (a dependency reason wins and costs
    # no gh call), or one set aside at its run or at a gate. task_held: lowercased slug -> its hold reason.
    ro_held = ro_entry is not None and ro_entry["held"]
    task_held, task_clears = {}, []
    if not (paused or pause_requested) and not ro_held:
        readers = stalled + [r for r in queued if not _unsatisfied(r, index)] + \
            [r for r in by_state.get("set-aside", []) if r["setAsideAt"] in ("run", "gate")]
        parsed = [(r, _hold_until(r["note"], root)) for r in sorted(readers, key=_rank)]
        parsed = [(r, h) for r, h in parsed if h is not None]
        resolved = _resolve_holds(args.gh_bin, [(r["slug"], "task", h) for r, h in parsed], hold_memo)
        for (r, h), (entry, reason) in zip(parsed, resolved):
            hold_entries.append(entry)
            if reason is not None:
                task_held[r["slug"].lower()] = reason
            elif entry["state"] == "MERGED":
                task_clears.append((r, h, entry))
    # The seeded revises step 1.2 launches (p28-5; _seeded_revises), which the fair share counts below: read here, before
    # the trickle claim lock, so the lock never spans their git and settings reads. None under a pause or a standing
    # rollout hold, where step 1.2 launches none; main red and a whole-rollout git-env hold (read below, where step 1.1
    # halts first) clear them too.
    revises = [] if (paused or pause_requested or ro_held) else \
        _seeded_revises(by_state.get("set-aside", []), task_held, rollout_note, root)
    # The Trickle claims (p28-3; away.md § The Trickle, *Trickle claims*), taken after every PR-hold gh call so the
    # lock never spans gh. Off --dry-run `next` takes the machine-wide trickle claim lock (the outermost lock:
    # Note.save's note locks and the Run record's flock are taken inside it, never the other way), walks --tasks-dir
    # afresh and holds the lock to the claims write below. A lock it cannot take fails open: one TRICKLE_WARN line,
    # the count without the lock, and this call's starts unclaimed. --dry-run takes no lock and reads the claims
    # against its own walk. An exception in between ends the process, which drops the flock.
    claim_lock_path, claims_path = _trickle_paths()
    claim_lock, claiming = None, False
    if args.dry_run:
        walk = index
    else:
        claim_lock = _note_lock(lock_path=claim_lock_path, label="trickle claim lock")
        try:
            claim_lock.__enter__()
            claiming = True
        except OSError as e:
            claim_lock = None
            print(f"{TRICKLE_WARN} {claim_lock_path}: {e} — counted without the lock; this call's starts are not "
                  "claimed", file=sys.stderr)
        walk = _note_index(tasks_dir)
    # The count elsewhere: the notes (_elsewhere_running, all that `status` and every progress line read) plus every
    # other lead's live claims (_trickle_claims_judge), per rollout. Each other rollout's lease is read at `now` (p28-4):
    # one whose lease has lapsed holds no room through its notes and is named under `lapsed` instead; its live claims
    # still count.
    lapsed = {}
    notes_elsewhere = _elsewhere_running(rollout_path, tasks_dir, walk, _Leases(now), lapsed)
    claims_read, waiting_raw, claims_why, claims_writable = _trickle_claims_read(claims_path)
    if claims_why:
        print(f"{TRICKLE_WARN} {claims_path} unreadable: {claims_why} — read as none" if claims_writable else
              f"{TRICKLE_WARN} {claims_path} {claims_why} — read as none, left for its writer", file=sys.stderr)
    wall = datetime.now().astimezone()
    claimed, claims_kept = _trickle_claims_judge(claims_read, tasks_dir, rollout_path.stem, walk, now, wall)
    # The waiting records (p28-5; away.md § The Trickle, *A fair share*): every other rollout's live one, the ones the
    # next write keeps, and this rollout's own (its `since` and `served`, inside the TTL).
    waiting_live, waiting_kept, own_wait = _trickle_waiting_judge(waiting_raw or [], tasks_dir, rollout_path.stem,
                                                                  walk, now, wall)
    elsewhere = _trickle_merge(notes_elsewhere, claimed)
    running_elsewhere = sum(elsewhere.values())
    # One Mac-wide cap whose value depends on Away state: the Trickle while not Away, the Away cap while Away.
    cap = _cap_in_force(away)["n"]
    cap_prefix = AWAY_CAP_PREFIX if away["away"] else TRICKLE_PREFIX
    # slot_held: rows held for want of a Slot, at the ceiling or the Mac-wide cap (the Trickle, or Away the Away cap);
    # their reason is set below.
    start, restart, holds, slot_held = [], [], [], []
    used = len(live)
    # mine: this rollout's own use of the Mac-wide cap before this call's starts, every in_progress row, live or
    # stalled, as every other lead counts it (_elsewhere_running). A new start fits only while
    # mine + starts < slot_limit.
    mine = len(in_progress)
    # Read once here, before the fair share, which needs them; each reads only the rollout note's logs, which nothing
    # before their overrides (after the rollout note's save, below) writes. An unacked git-env trip (execute § 4.5
    # *Git-env canary*) holds what it threatens until /thread:repair records Lachy's ack (ADR 0046): a bare checkout
    # (scope `rollout`, `whole`) holds the whole queue: nothing starts or restarts, every stalled or queued task is
    # held, and the halt is "git-env", ahead of every other verdict (a live call or a held lane included: the lead
    # halts at once). Any other trip holds the Integration lane only (laneHold). A RACE revert that did not land
    # (mainRed): main is red and every new start would branch from it (ADR 0046), so nothing starts or restarts until
    # Lachy's `RACE decided:` line.
    git_env = _git_env_hold(rollout_note)
    whole = [t for t in git_env if t["scope"] == "rollout"]
    main_red = _main_red(rollout_note)
    # The fair share (p28-5; away.md § The Trickle, *A fair share*): the free places on the Mac go out one at a time
    # among the rollouts waiting on them (_fair_share), each to the one holding fewest, then served least recently,
    # then waiting longest, and slot_limit leaves out the places it keeps for the others. This rollout contends with
    # `held` its own count and its `since` and `served` as its waiting record carries them, the values every other lead
    # reads in that record: `since` its own record's inside the TTL, else now; `served` the later of its own record's
    # and its latest `started:` stamp, so a start that no record saw (a call that could not take the lock writes none)
    # still moves it. Nothing is kept with no free place, under the heat (slot_limit is 0) or with no live record.
    my_since = own_wait["since"] if own_wait else now
    my_served = max((t for t in (own_wait and own_wait["served"], _latest_started(rows)) if t is not None),
                    default=None)
    free_places = cap - running_elsewhere - mine
    held_by = {k.lower(): n for k, n in elsewhere.items()}
    waiters = [{"name": w["name"], "held": held_by.get(k, 0), "served": w["served"], "since": w["since"],
                "demand": w["want"]} for k, w in waiting_live.items()]

    def fair_limit(demand):
        """(slot_limit, kept) for this call, its own demand `demand` (0 contends nothing)."""
        kept_ = {}
        if free_places > 0 and not heat["held"] and waiters:
            me = [{"name": rollout_path.stem, "held": mine, "served": my_served, "since": my_since,
                   "demand": demand}] if demand > 0 else []
            kept_ = {n: k for n, k in _fair_share(free_places, waiters + me, now).items() if n != rollout_path.stem}
        if heat["held"]:
            return 0, kept_
        return min(ceiling, max(0, cap - running_elsewhere - sum(kept_.values()))), kept_

    if main_red or whole:
        revises = []  # step 1.1 halts on either before step 1.2 launches a revise
    started, solo_head = [], None
    if paused or pause_requested:
        slot_limit, kept = fair_limit(0)  # nothing of this rollout starts: every free place is the waiters'
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
        # ceiling bounds it, never the Trickle or the Away cap: bounding it there would let two respawned leads each
        # wait on the other's stalled notes with nothing running (execute away.md § The Trickle).
        for r in sorted(stalled, key=lambda r: (-r["weight"], r["rank"])):
            if r["slug"].lower() in task_held:
                holds.append((r, task_held[r["slug"].lower()]))  # its own hold_until: never restarted
            elif used < ceiling:
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
            elif r["slug"].lower() in task_held:
                holds.append((r, task_held[r["slug"].lower()]))  # no candidate: a held Solo task holds nothing
            else:
                candidates.append(r)
        solo_started = next((r for r in sorted(started, key=_rank) if r["solo"]), None)
        # The head Solo task (p17-2): the first queued Solo task by rank whose dependencies are met. It holds every
        # task ranked below it, whatever their priority:, so priority and overlap order only the rows above it. A Solo
        # task its dependency holds is no candidate, so it holds nothing.
        solo_head = None if solo_started else min((r for r in candidates if r["solo"]), key=_rank, default=None)
        # This rollout's demand in the fair share: what it could start now, within its ceiling. Its queued rows: none
        # under a started Solo task, a standing rollout hold, main red or a whole-rollout git-env hold (each clears this
        # call's starts below); else the candidates above the head Solo task (all of them with none), or with none above
        # it, the head Solo's lone start while nothing of this rollout is started or owed a revise. Plus the seeded
        # revises (read above, before the lock), under a started Solo task too (step 1.2 never reads Solo). A revise is
        # no row of `next`'s, yet it takes a Slot under slotLimit like a start, so a rollout whose only work is a revise
        # still gets a place in line.
        if solo_started or ro_held or main_red or whole:
            startable = 0
        else:
            above = [r for r in candidates if solo_head is None or r["rank"] < solo_head["rank"]]
            startable = len(above) if above else int(solo_head is not None and not started and not revises)
        slot_limit, kept = fair_limit(min(startable + len(revises), max(0, ceiling - mine)))
        if solo_started:
            holds += [(r, f"behind solo [[{solo_started['slug']}]]") for r in candidates]
        else:
            in_flight = {f for r in started for f in r["files"]}
            remaining = list(candidates)
            while remaining:
                above = [r for r in remaining if solo_head is None or r["rank"] < solo_head["rank"]]
                best = (min(above, key=lambda r: (-r["weight"], _overlap(r["files"], in_flight), r["rank"]))
                        if above else solo_head)
                if best["solo"]:
                    remaining.remove(best)
                    if not started and not start and mine + len(start) < slot_limit:
                        why = last.hold(best)  # its Slot found: the last starts may still hold it
                        if why:
                            holds.append((best, why))
                        else:
                            start.append(best)
                    elif not started and not start:
                        slot_held.append(best)  # nothing of this rollout runs: only the Mac-wide cap holds it
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
                remaining.remove(best)
                why = last.hold(best)  # a Slot is found; a row the last starts hold is skipped, never a stop
                if why:
                    holds.append((best, why))
                    continue
                start.append(best)
                in_flight.update(best["files"])
    in_use = used + len(start)
    # Whichever binds first names the reason: the ceiling once this rollout fills it, else the Heat hold while the Mac
    # is hot, else the Mac-wide cap in force (`trickle:` not Away, `away cap:` Away), counted as `trickle.running` is
    # (no quotes, so it can ride a ROLLOUT-STATUS reason=). A stalled row is only ever held at the ceiling, which it
    # fills first.
    # While the fair share keeps places (p28-5), the cap's reason names them: `, <k> kept for [[R1]], [[R2]]`, in
    # `trickle.kept`'s order. The prefix never changes, so every reader of `trickle:` and `away cap:` reads it as
    # before.
    kept_for = (f", {sum(kept.values())} kept for " + ", ".join(f"[[{n}]]" for n in kept)) if kept else ""
    slot_why = (f"ceiling: {in_use}/{ceiling} slots in use" if in_use >= ceiling else
                f"{HEAT_PREFIX} the Mac is hot ({heat['name']})" if heat["held"] else
                f"{cap_prefix} {running_elsewhere + mine + len(start)}/{cap} tasks running on this Mac{kept_for}")
    holds += [(r, slot_why) for r in slot_held]
    # A rollout hold that stands (vault-grammar § Hold until) holds the whole queue, after the pause (a pause wins) and
    # before the git-env override (git-env wins): nothing starts or restarts, and every stalled or queued task waits on
    # it, its dependency, Solo and Slot reasons replaced. Live calls, Integration and set-asides carry on as they are.
    if ro_held and not (paused or pause_requested):
        start, restart = [], []
        used = len(live)
        holds = [(r, ro_reason) for r in stalled + queued]
    if not args.dry_run:
        start_cleared = _clear_start(rollout_note)
        rollout_note.save()
    # A merged rollout hold is removed in a save of its own, after the start stamp's: that save still fails the call
    # (exit 1, the stamp left for the Stage), while a failed clear only warns and the hold still releases for this call.
    # An approved queue's verdict that keeps the hold standing (waits, regenerate, an unreadable on_merge) never clears it.
    # A plain release of one (its verdict's `released`, or a done or dropped note) takes the `on_merge:` beside the hold
    # in the same swap, so a hold Lachy adds by hand later is a plain hold, never this PR's approval judged at its merge.
    if ro_entry is not None and ro_entry["state"] == "MERGED" and not ro_entry["held"]:
        om_lines = rollout_note.fm_block(ON_MERGE_KEY)
        ro_entry["cleared"] = _clear_hold(rollout_note, ro_hold, rollout_path.stem, args.dry_run,
                                          also=[(ON_MERGE_KEY, om_lines)] if om_lines is not None else [])
    for r, h, entry in task_clears:
        entry["cleared"] = _clear_hold(r["note"], h, r["slug"], args.dry_run)

    # The two overrides of git_env, whole and main_red (read above, before the fair share). A RACE revert that did not
    # land (mainRed) holds every start and restart first; the whole-rollout git-env override below still wins.
    if main_red:
        start, restart = [], []
        used = len(live)
        holds = [(r, f"{MAIN_RED_PREFIX} the revert of [[{main_red[0]['slug']}]] did not land: /thread:repair")
                 for r in stalled + queued]
    if whole:
        start, restart = [], []
        used = len(live)
        holds = [(r, "git-env hold: /thread:repair") for r in stalled + queued]
    # The claims write (p28-3), under the lock and only once the rollout note's save has succeeded (a failed one raised
    # above, so nothing is claimed), after the main-red and whole-rollout git-env overrides, so it reads the final
    # `start`: every kept entry plus one claim per start (the head Solo task's lone start included), replacing this
    # rollout's earlier claims. `start` is [] under a pause, a rollout hold, the heat, a whole-rollout git-env hold (a
    # bare checkout) or a main-red hold, which clears them; a lane git-env trip (ADR 0046) leaves it as it is, so its
    # starts are claimed. The same write carries the waiting list (p28-5): every record the judge kept, plus this
    # rollout's own (below), always replacing its earlier one. Skipped when neither list changed and the file read
    # cleanly, so a call that starts and finds nothing creates no file; a file of another version is never written.
    # Then the lock goes, before the best-effort records below.
    #
    # This rollout's waiting record (p28-5; away.md § The Trickle, *A fair share*), from its final holds and its seeded
    # revises: one while a row waits on the Mac-wide cap or the heat (`trickle:`, `away cap:` or `heat:`; a heat row
    # keeps the rollout's place in line through a hot spell), or while a seeded revise waits on slotLimit; none under a
    # pause, a rollout hold, main red or a whole-rollout git-env hold (their holds replace every Slot reason, and step
    # 1.2 launches no revise). `want` counts the waiting rows but the head Solo task's (that task's lone start alone
    # counts 1, with nothing of this rollout in flight, started this call or owed a revise, which step 1.2 launches
    # first), plus the revises step 1.2 cannot launch (it launches one while slotsInUse plus those it launched is below
    # slotLimit: rev_go), capped at the room its ceiling leaves, ceiling - (mine + starts + rev_go), so a row or a
    # revise the ceiling holds is never waited for. `served` is now once this call starts, else as the fair share read
    # it (a revise, like a restart, moves no `started:` stamp, so it never moves `served`); `since` carries. No record
    # at want 0.
    waits = [r for r, why in holds if why.startswith((TRICKLE_PREFIX, AWAY_CAP_PREFIX, HEAT_PREFIX))]
    in_flight_or_owed = live or restart or awaiting or integrating or race_held_lane or start or revises
    want = sum(1 for r in waits if r is not solo_head) or int(solo_head in waits and not in_flight_or_owed)
    rev_go = min(len(revises), max(0, slot_limit - used))
    want = min(want + len(revises) - rev_go, max(0, ceiling - (mine + len(start) + rev_go)))
    if claiming and claims_writable:
        at = now.astimezone().isoformat(timespec="seconds")
        here = os.path.realpath(str(tasks_dir))
        fresh = {(e["tasksDir"], e["rollout"], e["slug"]): e for e in claims_kept + [
            {"tasksDir": here, "rollout": rollout_path.stem, "slug": r["slug"], "at": at} for r in start]}
        new_claims = [fresh[k] for k in sorted(fresh)]
        mine_wait = [{"tasksDir": here, "rollout": rollout_path.stem, "since": _wait_ts(my_since), "at": at,
                      "served": _wait_ts(now) if start else (_wait_ts(my_served) if my_served else None),
                      "want": want}] if want > 0 else []
        new_waiting = sorted(waiting_kept + mine_wait, key=lambda e: (e["tasksDir"], e["rollout"].lower(), e["at"]))
        if new_claims != claims_read or new_waiting != waiting_raw or claims_why:
            why = _trickle_claims_write(claims_path, new_claims, new_waiting)
            if why:
                print(f"{TRICKLE_WARN} {claims_path}: {why} — this call's starts are not claimed", file=sys.stderr)
    if claim_lock is not None:
        claim_lock.__exit__(None, None, None)
    # laneHold: what holds the Integration lane. One `git-env` entry per unacked trip's slug, in log order; then one
    # `race` entry per undecided RACE (rank order) that is not reverted, or whose revert the lead still owes (`revert`:
    # true, the lane's first work, execute § 4.5 step 1.4), or that was reverted with `main not re-verified`. A RACE
    # reverted with main's tree restored, its tail done, frees the lane (it stays in raceHold for Lachy). Then one `lane`
    # entry per unacked `## Lane log` hold (ADR 0048, p29-7: a cause that reaches every merge), in log order.
    reverts = _race_reverts(rollout_note)
    in_lane = {r["slug"].lower() for r in race_held_lane}
    lane_hold, seen = [], set()
    for t_ in git_env:
        if t_["slug"].lower() not in seen:
            seen.add(t_["slug"].lower())
            lane_hold.append({"slug": t_["slug"], "hold": "git-env"})
    for h in race_hold:
        if h["kind"] != "RACE":
            continue
        e = reverts.get(h["slug"].lower())
        pending = _race_revert_pending(e, h["slug"].lower() in in_lane)
        if not (e and e["reverted"]) or pending or e["unverified"]:
            lane_hold.append({"slug": h["slug"], "hold": "race", "revert": pending})
    for h in _lane_log_hold(rollout_note):
        lane_hold.append({"slug": h["slug"], "hold": "lane", "cause": h["cause"], "stamp": h["stamp"]})
    lane_git_env = any(e["hold"] == "git-env" for e in lane_hold)
    # A git-env trip or a Lane hold stops everything in the lane, a pending RACE revert included.
    lane_blocked = any(e["hold"] in ("git-env", "lane") for e in lane_hold)
    # The lane moves while nothing holds it and something awaits Integration, integrates or holds it for a RACE
    # re-verify, or while the lead owes a RACE revert and no git-env trip or Lane hold stands.
    lane_moving = (not lane_hold and bool(awaiting or integrating or race_held_lane)) or \
        (not lane_blocked and any(e.get("revert") for e in lane_hold))
    in_n = [r for r in rows if r["state"] not in OUTSIDE_N]
    counts = _counts(rows)
    halt = None
    sign_off = []
    # A row the Trickle or the Away cap holds could start once the Mac has room, so it never halts the rollout (D6 of
    # p28-1; ADR 0049: a meant wait, never Stalled): the lead waits (§ 4.5 step 1.6) instead of reading stuck or
    # awaiting-sign-off. cap_held names the cap that holds a row: "trickle", "away-cap" or None.
    cap_held = next(("away-cap" if why.startswith(AWAY_CAP_PREFIX) else "trickle" for _, why in holds
                     if why.startswith((TRICKLE_PREFIX, AWAY_CAP_PREFIX))), None)
    # Nor does a row the last starts hold: at the Morning the file reads not Away and the Trickle takes over.
    last_start_held = any(why.startswith(LAST_START_PREFIX) for _, why in holds)
    # Nor does a row the Heat hold holds: it could start once the Mac cools.
    heat_held = any(why.startswith(HEAT_PREFIX) for _, why in holds)
    if whole:
        halt = "git-env"
    elif main_red:
        halt = "race"   # at once: a revert that did not land holds the whole rollout, whatever runs, pauses or holds
    elif on_merge is not None and on_merge["action"] == "regenerate" and not lane_hold:
        # The approved queue's regenerate (p30-4): ahead of every verdict but git-env and race, `empty` included (an
        # interrupted chain's prior links no task once step 6's carry moved them), so the lead takes execute's route. A
        # lane hold (a lane git-env trip or an undecided RACE, ADR 0046) halts first, as every git-env trip did before.
        halt = "regenerate"
    elif not start and not restart and not live and not lane_moving \
            and not cap_held and not last_start_held and not heat_held:
        if lane_git_env:
            halt = "git-env"
        elif any(e["hold"] == "race" and not e["revert"] for e in lane_hold):
            halt = "race"
        elif any(e["hold"] == "lane" for e in lane_hold):
            halt = "lane"   # a Lane hold (ADR 0048): only Lachy's ack, through /thread:repair § 3g, releases it
        elif paused:
            halt = "paused"
        elif not in_n:
            halt = "empty"
        elif counts["merged"] == counts["total"]:
            halt = "done" if _ceremony_done(rollout_path, rollout_note) else "complete"
        elif any(e["held"] for e in hold_entries):
            # A PR hold (vault-grammar § Hold until) explains the idle queue: the lead waits on the merge, or puts a
            # CLOSED or unreadable hold to Lachy (execute § 4.5 step 1.5), never reading it as stuck. Ahead of
            # awaiting-sign-off: under a rollout hold the lead's standing approval is skipped (step 1.2).
            halt = "held"
        else:
            # ADR 0034: a gate alone never halts `stuck`. When every unlanded task waits only on a gate (W), the
            # verdict is awaiting-sign-off: execute's step 5 runs its sign-off form and the rollout closes.
            sign_off = _sign_off_wait(rows, index)
            halt = "awaiting-sign-off" if sign_off else "stuck"
    # The time-lost ledger (p29-10): a sleep no entry follows is written here, off --dry-run, before idle-slots.
    if not args.dry_run:
        _record_sleeps(rollout_path.stem, rollout_note, now, args)
    # The Run record (p15-2): a reason marker for the idle Slots this call leaves (none at complete, done or empty).
    free = ceiling - (used + len(start))
    if free > 0 and halt not in ("complete", "done", "empty") and not args.dry_run:
        reason = _idle_reason(whole, paused, pause_requested, holds, queued, start, race_hold,
                              by_state.get("set-aside", []), cap_held, last_start_held, ro_held, bool(task_held),
                              heat_held=heat_held, main_red=main_red)
        _event(rollout_path.stem, "idle-slots", None,
               {"reason": reason, "free": free, "settings": _rollout_settings(rollout_note, ceiling)}, args)
    # The night record (Chorus ADR 0104's Consequences; execute away.md § The night record), after idle-slots.
    if not args.dry_run:
        _night_record(rollout_path.stem, last, holds, index, now, args)
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
                    "awayCap": away["awayCap"], "until": away["until"], "morning": away["morning"],
                    "elsewhere": elsewhere,
                    # p28-4: the rollouts left out of the count because their lead's lease has lapsed, {stem: n}.
                    "lapsed": lapsed,
                    # The Mac-wide cap's count after this call: the count elsewhere plus this rollout's own use.
                    "running": running_elsewhere + mine + len(start),
                    # The places the fair share keeps for waiting rollouts (p28-5): {<rollout>: n}, n > 0, sorted.
                    "kept": kept},
        "lastStarts": last.output(),
        "heat": {"level": heat["level"], "name": heat["name"]},
        "start": slugs(start),
        "restart": slugs(restart),
        "hold": [{"slug": r["slug"], "reason": why} for r, why in sorted(holds, key=lambda h: _rank(h[0]))],
        "running": slugs(live),
        "awaitingIntegration": slugs(sorted(awaiting, key=lambda r: _lane_key(r, waited))),
        "integrating": slugs(integrating),
        "setAside": [_set_aside_entry(r, task_held.get(r["slug"].lower())) for r in by_state.get("set-aside", [])],
        "raceHold": race_hold,
        "gitEnvHold": git_env,
        "laneHold": lane_hold,
        "mainRed": main_red,
        # The PR holds this call read (vault-grammar § Hold until): the rollout's first, then the tasks' in rank order.
        "holdUntil": hold_entries,
        # The approved queue's verdict at the merge (p30-4; vault-grammar § Approved queue): {note, pr, url, action:
        # regenerate|waits|released, members, successor, why, detail}, or null. supersededBy is the backstop's (null here).
        "onMerge": on_merge,
        "supersededBy": None,
        "paused": paused,
        "pauseRequested": pause_requested,
        "pausedNow": paused_now,
        "startUnattended": start_unattended,
        "startCleared": start_cleared,
        "halt": halt,
        "awaitingSignOff": sign_off,
        # The ETA counts notes only (p28-6; away.md § The Trickle), as `status` and every other progress line do.
        "progress": _progress_line(counts, _timeline(rows, counts, ceiling, now,
                                                     _eta_width(ceiling, away, notes_elsewhere))),
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
    is anything else. Read by await-sign-off and clear-pause; it writes nothing. It reads no hold_until and calls no gh
    (p30-3): `next` halts "held" ahead of awaiting-sign-off, so the lead never reaches await-sign-off on a held rollout."""
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


def _run_canary(verb, rollout_path, tasks_dir, repo, default, slug, kind, stdout=None, own_session=False) -> int:
    """`git-env-canary.py <verb>` for one window as a subprocess, so the canary keeps its own lock, git-env scrub and
    exit codes; its stderr passes through, its stdout too unless `stdout` redirects it. own_session keeps a stop
    sent to the caller's group from killing it mid-pass. An OSError or a signal counts as 2."""
    cmd = [sys.executable, str(GIT_ENV_CANARY_PY), verb, "--rollout", str(rollout_path), "--tasks-dir",
           str(tasks_dir), "--repo", str(repo), "--default", default, "--slug", slug, "--kind", kind]
    sys.stdout.flush()
    sys.stderr.flush()
    try:
        rc = subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=stdout, start_new_session=own_session).returncode
    except OSError as e:
        print(f"git-env-canary: cannot run {GIT_ENV_CANARY_PY}: {e}", file=sys.stderr)
        return 2
    return 2 if rc < 0 else rc


def _arm_task_window(args, slug, rollout_path) -> int:
    """mark-started's arm (p26-3): _run_canary's `arm --kind task`."""
    return _run_canary("arm", rollout_path, Path(os.path.expanduser(args.tasks_dir)), args.arm_repo,
                       args.arm_default, slug, "task")


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
    note. Records slot-taken (p15-2), its start read before the markers are removed, with the Mac-wide cap in force
    (p29-8)."""
    if (args.arm_repo is None) != (args.arm_default is None):
        print("ERROR: mark-started: --arm-repo <repoPath> and --arm-default <B> go together (p26-3); nothing written",
              file=sys.stderr)
        return 2
    now = _now(args)
    rollouts = {}
    away = {}  # slot-taken's Away state (_record_slot_taken): read once per run, on first use, never on --dry-run

    def away_once():
        if "state" not in away:
            away["state"] = _away_state(now)
        return away["state"]

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
        _record_slot_taken(args, slug, note, rollout, start, rollouts, away_once)
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
        elif _reverted_pr(rollouts[ro.lower()], note):
            # The RACE revert undid its merge on main: re-entering would integrate or land a reverted PR.
            held.append(f"hand-back: [[{slug}]]: its merge was reverted on main: re-land it through a new pr: or defer "
                        f"(/thread:repair [[{ro}]]); nothing written")
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
    ended = now.astimezone().isoformat(timespec="seconds")
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
                        "durationMinutes": _whole_minutes(started, ended)},
        }}
        # p29-13: the lead's own Integration is no call, so only the stops its Run record logs and the Mac's sleeps it
        # does not hold yet come off.
        line = _integration_log_line(row, _active_minutes(_note_rollout(note), slug, started, ended,
                                                          row["integration"]["metrics"]["durationMinutes"], call=False,
                                                          now=now))
        # A re-run of the same Integration (same --started, same record) is a no-op even at a later --now:
        # every token but the measured duration and active must match. append_line's own dedupe covers the rest.
        key = line.split(" ")[:8]
        logged = [l.split(" ") for l in _log_lines(note)]
        if not any(t[:8] == key for t in logged):
            note.append_line(INTEGRATION_LOG_SECTION, line)
        note.save(dry_run=args.dry_run)
        print(f"{slug}: integration log += {line}{_flag(args, note)}")
    return _finish(args, now)


# ---- resume (p6-8) ------------------------------------------------------------------

def _gh(gh_bin, argv, cwd, timeout=120):
    """(stdout, error) for one gh call; error is None on success. `timeout` in seconds (`next`'s hold reads pass
    HOLD_GH_TIMEOUT)."""
    try:
        p = subprocess.run([gh_bin, *argv], cwd=cwd, capture_output=True, text=True, timeout=timeout)
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
        if _reverted_pr(rollout_note, note):
            # Its merge was reverted on main (the RACE revert): MERGED on GitHub, but its change is not on main.
            print(f"{slug}: its merge was reverted on main: re-land it through a new pr: or defer (/thread:repair) "
                  "[no-change]")
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
    # The Trickle line (p28-6; status SKILL.md § 4): the Away state and the Mac-wide count, read as `next` reads them
    # but silently (no WARN: only `next` prints it), and never through `next`. `here` is this rollout's own count as
    # another lead's _elsewhere_running reads it: 0 unless its note sits directly in --tasks-dir, and 0 while its own
    # lead's lease reads lapsed (p28-4). The leases are read as `next` reads them, never written: `lapsed` names the
    # other rollouts a lapsed lease leaves out, and `lease` is this rollout's own ({state, writtenAt, lapsesAt}).
    away = _away_state(now)
    leases, lapsed = _Leases(now), {}
    elsewhere = _elsewhere_running(rollout_path, tasks_dir, index, leases, lapsed)
    lease = leases.state(rollout_path.stem, rollout_note)
    direct = rollout_path.resolve().parent == tasks_dir.resolve()
    here = _counted_running(rollout_note, [(r["path"], r["note"]) for r in rows]) \
        if direct and lease["state"] != "lapsed" else 0
    trickle = {"away": away["away"], "file": away["file"], "why": away["why"], "limit": away["limit"],
               "awayCap": away["awayCap"], "until": away["until"], "morning": away["morning"],
               "elsewhere": elsewhere, "lapsed": lapsed, "here": here, "running": sum(elsewhere.values()) + here,
               "lease": lease}
    timeline = _timeline(rows, counts, ceiling, now, _eta_width(ceiling, away, elsewhere))
    root = _project_root(rollout_note)   # a bare hold_until number reads against it (no gh: status is a pure read)
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
            # p30-3: the task's own hold_until as parsed, {pr, url, error}, whatever its state, or null (no gh call).
            "holdUntil": _hold_public(_hold_until(r["note"], root)),
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
        # repo keeps this as its one unfinished parallel rollout until they are signed or deferred, though it holds no
        # Project root against serial chains meanwhile, ADR 0060), else null.
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
        # The Trickle and the Away cap as `next` reads them (execute away.md), plus `here`, this rollout's own count,
        # and `lease`, its own lead's lease (p28-4): {away, file, why, limit, awayCap, until, morning, elsewhere,
        # lapsed, here, running, lease}. A pure read of away.json and the leases (sysctl only when one would lapse).
        "trickle": trickle,
        # {source, rungs, error}: the ladder status read (built-in, or the file's path); error non-null when the
        # file is refused, and then rungs is [] (execute halts `ladder file refused` at each call's start).
        "ladder": ladder,
        # The unacked git-env trips (_git_env_hold; execute § 4.5 *Git-env canary*), each with its `scope`: [] when
        # none. Vault-only, so status § 3's Git-env trip flag holds offline too.
        "gitEnvHold": _git_env_hold(rollout_note),
        # The unacked Lane-log holds (_lane_log_hold; ADR 0048, execute § 4.5 *Lane hold*): [{slug, cause, stamp,
        # line}], [] when none. Vault-only, so status § 3's Lane hold flag holds offline too.
        "laneLog": _lane_log_hold(rollout_note),
        # The RACE reverts that did not land and that no `RACE decided:` line lifts (_main_red): main is red, so the
        # whole rollout is held (status § 3's Main red). Vault-only too.
        "mainRed": _main_red(rollout_note),
        # The rollout's own hold_until (p30-3; vault-grammar § Hold until) as parsed, {pr, url, error}, or null. Only
        # `next` reads its PR (gh) and clears it, so /thread:status reads the state live itself (status § 3).
        "holdUntil": _hold_public(_hold_until(rollout_note, root)),
        # p30-4 (vault-grammar § Approved queue): the note's on_merge as read, {value, error}, on a parallel note that
        # carries a rollout hold_until (anywhere else it is read by nothing), else null; and chainStart, {prior, pr} when
        # this note is a chain's N whose start was never stamped (_chain_start), else null. Pure reads, no gh.
        "onMerge": _on_merge(rollout_note) if _shape(rollout_note) == SHAPES[0] and
        rollout_note.fm_block(HOLD_KEY) is not None else None,
        "chainStart": _chain_start(rollout_path, rollout_note, [(r["path"], r["note"]) for r in rows], index),
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
# p29-12: the `stamp` of an event a row that ends a Slot records: its ts is the call's own end (_call_end), or, with no
# end readable, the reconcile's clock (run_record.py's slot-freed, ready, merged, set-aside, quota-stall and
# review-verdict, its call-end stamps).
CALL_END_MARK = "call-end"
CALL_END_FALLBACK = "fallback"
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


# ---- the time-lost ledger (p29-10, ADR 0051): stops, resumes, suites and the load around them ---------------------
# run_record.py's docstring holds the kinds and the stop model (its one copy); these are the writers' shared pieces.

ENTRY_BYS = ("lachy", "stage", "watchdog", "heartbeat", "repair")       # record-entry --by
ENTRY_CAUSES = ("usage-limit", "dead-lead", "watchdog")                 # record-entry --cause
OPEN_STOP_CAUSES = ("usage-limit", "dead-lead", "mac-restart", "halt", "watchdog")  # a stop an entry resumes from
CALL_KINDS = ("task", "revise", "integrate", "resume")                  # run-bound's `call`
# A line that is no sign of the lead's life: the night record (written at a later `next`), a suite-ended (an orphaned
# suite can outlive its lead), a call-journal (folded at completion or by a Reflection, at fold time) and an inferred
# stopped line (written by the entry that found it).
NOT_LIVE_KINDS = NIGHT_KINDS + ("suite-ended", "call-journal")
MACHINE_TIMES_ENV = "THREAD_MACHINE_TIMES"   # a test's {boot, sleeps: [[S, W], ...], wake?} in place of the Mac's reads
PMSET_TIMEOUT = 15
PMSET_LINE_RE = re.compile(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d [+-]\d{4}) (Sleep|Wake|DarkWake)\s*\t")
KERN_TIME_RE = re.compile(r"\bsec\s*=\s*(\d+)(?:\s*,\s*usec\s*=\s*(\d+))?")
SAME_WAKE = timedelta(seconds=120)   # pmset's full Wake and kern.waketime name one wake within this
DIFF_HASH_MAX = 32 * 1024 * 1024     # tree_state hashes `git diff HEAD --binary` only up to this size
TREE_GIT_TIMEOUT = 60
# git's own repo-local variables (`git rev-parse --local-env-vars`): never let a caller's GIT_DIR read another tree.
GIT_LOCAL_VARS = ("GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_CONFIG", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT",
                  "GIT_OBJECT_DIRECTORY", "GIT_DIR", "GIT_WORK_TREE", "GIT_IMPLICIT_WORK_TREE", "GIT_GRAFT_FILE",
                  "GIT_INDEX_FILE", "GIT_NO_REPLACE_OBJECTS", "GIT_REPLACE_REF_BASE", "GIT_PREFIX", "GIT_SHALLOW_FILE",
                  "GIT_COMMON_DIR")
SUITE_SIGNALS = tuple(getattr(signal, n) for n in ("SIGTERM", "SIGINT", "SIGHUP") if hasattr(signal, n))


def _rec_ts(d):
    """A record line's ts as an aware datetime, or None."""
    return _away_stamp(d.get("ts"))[0]


def _ms(dt) -> int:
    """An instant's identity to the millisecond (a boot or a wake the record names)."""
    return int(round(dt.timestamp() * 1000))


def _zms(dt) -> str:
    """A ledger stamp (at, boot, wake): UTC `Z`, to the millisecond, as run_record.py stamps ts."""
    return _utc_z(dt, ms=True)


def _record_read(rollout):
    """The rollout's Run record lines (dicts, file order): [] with no file, None when it cannot be read."""
    try:
        path = _run_record().record_path(rollout)
    except Exception:  # noqa: BLE001 — an unresolvable record is an unreadable one
        return None
    try:
        return _record_lines(path)[0]
    except FileNotFoundError:
        return []
    except OSError:
        return None


def _call_entry(task, run):
    out = {"task": task}
    if isinstance(run, dict):
        if isinstance(run.get("runId"), str) and run["runId"]:
            out["runId"] = run["runId"]
        if run.get("call") in CALL_KINDS:
            out["call"] = run["call"]
    return out


def inflight_calls(lines, upto=None):
    """The calls the record shows in flight at `upto` (an aware datetime; None: after the last line), at most
    run_record.py's MAX_CALLS {task, runId?, call?}: the Slots, the lane and the run-bound lines replayed over the lines
    whose ts is at or before `upto`, by run_record.py's pairing rules. Each open Slot gives its task's latest run-bound
    after its slot-taken (a task, revise or resume call); the lane holder, when no Slot of its own is open, gives its
    latest integrate run-bound after its lane-taken, and nothing without one (the lead's own Integration is no call)."""
    slots, lane, lane_run = {}, None, None
    for d in lines:
        if upto is not None:
            ts = _rec_ts(d)
            if ts is None or ts > upto:
                continue
        kind, task = d.get("kind"), d.get("task")
        if not isinstance(task, str) or not task:
            continue
        if kind == "slot-taken":
            slots.setdefault(task, None)
        elif kind == "slot-freed":
            slots.pop(task, None)
        elif kind == "carried" and d.get("rollout") == d.get("from"):
            slots.pop(task, None)
            if lane == task:
                lane, lane_run = None, None
        elif kind == "lane-taken":
            if lane != task:
                lane, lane_run = task, None
        elif kind == "lane-freed":
            if lane == task:
                lane, lane_run = None, None
        elif kind == "run-bound":
            run = {"runId": d.get("runId"), "call": d.get("call")}
            if d.get("call") == "integrate":
                if lane == task:
                    lane_run = run
            elif task in slots:
                slots[task] = run
    out = [_call_entry(task, run) for task, run in slots.items()]
    if lane is not None and lane_run is not None and lane not in slots:
        out.append(_call_entry(lane, lane_run))
    return out[:_run_record().MAX_CALLS]


def _pause_stands(note, lines):
    """(stands, start): whether Lachy's pause stands, for record-entry and the Stop hook alike. It stands when the
    rollout note carries a `paused:` stamp, or the record's replay leaves a `paused` line open (no `resumed` after it).
    start is that open line's ts, else the stamp; None when neither parses."""
    open_line = None
    for d in lines or ():
        kind = d.get("kind")
        if kind == "paused" and open_line is None:
            open_line = d
        elif kind == "resumed":
            open_line = None
    stamp = _scalar(note.get("paused")) if note is not None else ""
    if open_line is None and not _valued(stamp):
        return False, None
    start = _rec_ts(open_line) if open_line is not None else None
    return True, start or (_parse_ts(stamp) if _valued(stamp) else None)


def _ledger_skip(note) -> str:
    """Why a rollout's lead records no stop and no entry, or "": a serial rollout (Legs never run record-entry), a
    superseded note, or a done or dropped one."""
    if _shape(note) == "serial":
        return "shape: serial (a serial rollout runs as Legs)"
    if _valued(note.get("superseded_by")):
        return "superseded"
    if _status(note) in CLOSED_ROLLOUT_STATUSES:
        return f"status: {_status(note)}"
    return ""


def _kern_time(text):
    """kern.boottime / kern.waketime / kern.sleeptime's `{ sec = S, usec = U }` as an aware UTC datetime; None for
    sec 0 or no match."""
    m = KERN_TIME_RE.search(text or "")
    if not m or int(m.group(1)) == 0:
        return None
    return datetime.fromtimestamp(int(m.group(1)) + int(m.group(2) or 0) / 1e6, timezone.utc)


def _sysctl_times():
    """(boot, wake, sleep): the Mac's kern.boottime, kern.waketime and kern.sleeptime, each None when unreadable (a
    machine without them reads None)."""
    out = []
    for key in ("kern.boottime", "kern.waketime", "kern.sleeptime"):
        try:
            p = subprocess.run(["sysctl", "-n", key], capture_output=True, text=True, timeout=5)
            out.append(_kern_time(p.stdout) if p.returncode == 0 else None)
        except (OSError, subprocess.SubprocessError, ValueError):
            out.append(None)
    return tuple(out)


def sleep_spans(text, since, wake):
    """The sleeps in `pmset -g log` output (pure): [(S, W)] in log order, aware UTC. Only lines matching
    PMSET_LINE_RE are read (`<date> <time> <zone> Sleep|Wake|DarkWake<tab>`), so "Wake Requests", WakeDetails and
    WakeTime never match. A span opens at the first Sleep after a full Wake (or at the log's start) and closes at the
    next full Wake: the DarkWake .. Sleep cycles between (Power Nap) stay inside it. A span still open at the log's end
    closes at `wake` (kern.waketime) when that is later; otherwise the last span's wake, when within SAME_WAKE of
    `wake`, becomes `wake` itself, the identity `next`'s gate compares. Spans whose wake is not after `since` (None:
    every span) are dropped."""
    spans, start = [], None
    for line in (text or "").splitlines():
        m = PMSET_LINE_RE.match(line)
        if not m:
            continue
        try:
            t = datetime.strptime(m.group(1), "%Y-%m-%d %H:%M:%S %z").astimezone(timezone.utc)
        except ValueError:
            continue
        if m.group(2) == "Sleep":
            if start is None:
                start = t
        elif m.group(2) == "Wake" and start is not None:
            spans.append([start, t])
            start = None
    if start is not None and wake is not None and wake > start:
        spans.append([start, wake])
    elif spans and wake is not None and abs(spans[-1][1] - wake) <= SAME_WAKE:
        spans[-1][1] = wake
    return [(s, w) for s, w in spans if s <= w and (since is None or w > since)]


def _machine_override(raw, since):
    """THREAD_MACHINE_TIMES (tests, and tests/run.sh's backstop `{}`): {boot, sleeps: [[S, W], ...], wake?}, Z stamps
    or null, in place of every read of the Mac. Malformed reads as no evidence."""
    out = {"boot": None, "wake": None, "sleeps": []}
    try:
        data = json.loads(raw) if raw.strip() else {}
    except ValueError:
        return out
    if not isinstance(data, dict):
        return out
    stamp = lambda v: _away_stamp(v)[0].astimezone(timezone.utc) if _away_stamp(v)[0] else None  # noqa: E731
    out["boot"] = stamp(data.get("boot"))
    spans = []
    for pair in data.get("sleeps") or []:
        if isinstance(pair, list) and len(pair) == 2:
            s, w = stamp(pair[0]), stamp(pair[1])
            if s is not None and w is not None and s <= w:
                spans.append((s, w))
    out["wake"] = stamp(data.get("wake")) or (max(w for _s, w in spans) if spans else None)
    out["sleeps"] = [(s, w) for s, w in spans if since is None or w > since]
    return out


def machine_times(since, now=None):
    """The Mac's own evidence of a stop no process lived to log: {boot, wake, sleeps: [(S, W)]}, aware UTC (run_record's
    stop model; ADR 0051). boot is kern.boottime; wake kern.waketime, the cheap gate: with none, or one not after
    `since`, sleeps is [] and pmset is never read. Otherwise `pmset -g log` (PMSET_TIMEOUT) through sleep_spans, since
    kern.sleeptime is only the last sleep (a Power Nap cycle's, often); when pmset fails or finds no span, one span
    (kern.sleeptime, wake) when it is earlier. Evidence after `now` is dropped. THREAD_MACHINE_TIMES replaces every
    read."""
    raw = os.environ.get(MACHINE_TIMES_ENV)
    if raw is not None:
        out = _machine_override(raw, since)
    else:
        boot, wake, slept = _sysctl_times()
        out = {"boot": boot, "wake": wake, "sleeps": []}
        if wake is not None and (since is None or wake > since):
            try:
                p = subprocess.run(["pmset", "-g", "log"], capture_output=True, text=True, errors="replace",
                                   timeout=PMSET_TIMEOUT)
                text = p.stdout if p.returncode == 0 else ""
            except (OSError, subprocess.SubprocessError, ValueError):
                text = ""
            out["sleeps"] = sleep_spans(text, since, wake)
            if not out["sleeps"] and slept is not None and slept < wake:
                out["sleeps"] = [(slept, wake)]
    if now is not None:
        if out["boot"] is not None and out["boot"] > now:
            out["boot"] = None
        out["sleeps"] = [(s, w) for s, w in out["sleeps"] if w <= now]
    return out


def _git_env():
    return {k: v for k, v in os.environ.items() if k not in GIT_LOCAL_VARS}


def tree_state(tree) -> dict:
    """{sha, dirty, diff?} of a git tree, the suite's identity (so a re-run of a passed tree shows): sha its HEAD, dirty
    whether it has tracked changes, diff the first 12 hex of the sha256 of `git diff HEAD --binary` on a dirty tree
    (skipped past DIFF_HASH_MAX). git runs with GIT_LOCAL_VARS stripped and TREE_GIT_TIMEOUT. {} when git cannot read
    the tree."""
    env = _git_env()

    def git(*argv):
        return subprocess.run(["git", "-C", str(tree), *argv], capture_output=True, env=env, timeout=TREE_GIT_TIMEOUT)
    try:
        p = git("rev-parse", "--verify", "-q", "HEAD")
        sha = p.stdout.decode("ascii", "replace").strip()
        if p.returncode != 0 or not sha:
            return {}
        st = git("status", "--porcelain", "--untracked-files=no")
        out = {"sha": sha, "dirty": st.returncode == 0 and bool(st.stdout.strip())}
        if not out["dirty"]:
            return out
        proc = subprocess.Popen(["git", "-C", str(tree), "diff", "HEAD", "--binary"], stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, env=env)
        h, size, whole = hashlib.sha256(), 0, True
        try:
            for chunk in iter(lambda: proc.stdout.read(1 << 16), b""):
                size += len(chunk)
                if size > DIFF_HASH_MAX:
                    whole = False
                    break
                h.update(chunk)
        finally:
            if proc.poll() is None and not whole:
                proc.kill()
            proc.stdout.close()
            proc.wait(timeout=TREE_GIT_TIMEOUT)
        if whole and proc.returncode == 0:
            out["diff"] = h.hexdigest()[:12]
        return out
    except (OSError, subprocess.SubprocessError, ValueError):
        return {}


def load_now():
    """The 1, 5 and 15 minute load average, rounded to 2 places, or None."""
    try:
        return [round(x, 2) for x in os.getloadavg()]
    except (OSError, AttributeError):
        return None


def _secs(x):
    """A ledger duration in seconds: >= 0, to a tenth, and an int when whole (a 2 s --timeout reads 2, not 2.0)."""
    v = round(max(0.0, float(x)), 1)
    return int(v) if v == int(v) else v


def new_suite_id() -> str:
    """A suite's id: `s-` and 16 lowercase hex, shared by its suite-started and suite-ended."""
    return "s-" + os.urandom(8).hex()


class _signals_held:
    """Hold TERM, INT and HUP across one record write: run_record.emit swallows any exception, so a stop's handler
    raising inside it would be lost. A signal that lands meanwhile is delivered, and its handler runs, as the block
    ends, so a caller's `reraise` still takes its own signal path."""

    def __enter__(self):
        try:
            self.mask = signal.pthread_sigmask(signal.SIG_BLOCK, SUITE_SIGNALS)
        except (AttributeError, OSError, ValueError):
            self.mask = None
        return self

    def __exit__(self, *_exc):
        if self.mask is not None:
            signal.pthread_sigmask(signal.SIG_SETMASK, self.mask)
        return False


def suite_started(rollout, task, suite, by, runner, state, tasks_dir=None, waited=None, reraise=(), written=None):
    """Record one suite's start (suite-started; run_record.py's suite pairing): `state` is tree_state's reading, taken
    by the caller (verify-slot.py reads it before its slot wait). load is load_now(), running mac_running(tasks_dir).
    Best-effort: never raises, but an exception in `reraise` (the caller's signal) propagates, from the vault walk for
    `running` too (a stop there writes no line); a tree with no sha records nothing. written["started"] is set to
    whether the line landed, before a held signal is delivered. Returns that."""
    try:
        if not rollout or not isinstance(state, dict) or not state.get("sha"):
            return False
        fields = {"suite": suite, "by": by, "runner": runner, "sha": state["sha"], "dirty": bool(state.get("dirty"))}
        if state.get("diff"):
            fields["diff"] = state["diff"]
        load = load_now()
        if load is not None:
            fields["load"] = load
        if waited is not None:
            fields["waited"] = _secs(waited)
        if tasks_dir is not None:
            n = mac_running(tasks_dir, reraise=reraise)
            if n is not None:
                fields["running"] = n
        with _signals_held():
            ok = _event(rollout, "suite-started", task, fields)
            if written is not None:
                written["started"] = ok
        return ok
    except reraise:
        raise
    except Exception:  # noqa: BLE001 — recording never changes a suite's outcome
        return False


def suite_ended(rollout, task, suite, by, runner, outcome, seconds, tasks_dir=None, scan=True, reraise=(), rc=None,
                failing=None, timeout=None, step=None, sha=None, waited=None):
    """Record one suite's end (suite-ended): load is load_now(); running mac_running(tasks_dir), only with `scan` (a
    stop by signal passes scan=False: no vault walk on that path); rc only an int 0-255 and never on noslot or heat;
    timeout only on outcome timeout; failing cut to 50 names of 200 characters. Best-effort, as suite_started."""
    try:
        if not rollout:
            return False
        fields = {"suite": suite, "by": by, "runner": runner, "outcome": outcome,
                  "seconds": _secs(seconds)}
        load = load_now()
        if load is not None:
            fields["load"] = load
        if isinstance(rc, int) and not isinstance(rc, bool) and 0 <= rc <= 255 and outcome not in ("noslot", "heat"):
            fields["rc"] = rc
        if failing is not None:
            fields["failing"] = [str(f)[:200] for f in failing if f][:50]
        if timeout is not None and outcome == "timeout":
            fields["timeout"] = _secs(timeout)
        if step in ("env_bootstrap", "verifier"):
            fields["step"] = step
        if sha:
            fields["sha"] = sha
        if waited is not None:
            fields["waited"] = _secs(waited)
        if scan and tasks_dir is not None:
            n = mac_running(tasks_dir, reraise=reraise)
            if n is not None:
                fields["running"] = n
        with _signals_held():
            return _event(rollout, "suite-ended", task, fields)
    except reraise:
        raise
    except Exception:  # noqa: BLE001
        return False


def _stop_state(lines) -> dict:
    """The record read for a stop (run_record.py's stop model): {entry, session, live, open, named, wake}. entry is the
    last lead-entry's ts and session that line's session (None when it carried none); live the sorted ts of every line
    that is a sign of the lead's life (all but NOT_LIVE_KINDS and an inferred stopped line: a lead-entry and a live
    stopped count), a line stamped at its call's end (p29-12) counting at its reconciledAt when that is later, the
    lead's own write; open the non-sleep stopped lines after the last lead-entry, in file order (the last is the open
    stop); named the boots and wakes the record already names (_ms); wake the latest mac-sleep's wake."""
    st = {"entry": None, "session": None, "live": [], "open": [], "named": set(), "wake": None}
    last = -1
    for i, d in enumerate(lines):
        kind, ts = d.get("kind"), _rec_ts(d)
        if kind == "lead-entry":
            last = i
            st["entry"] = ts
            st["session"] = d.get("session") if isinstance(d.get("session"), str) and d.get("session") else None
        elif kind == "stopped":
            for key in ("boot", "wake"):
                t = _away_stamp(d.get(key))[0]
                if t is not None:
                    st["named"].add(_ms(t))
                    if key == "wake" and (st["wake"] is None or t > st["wake"]):
                        st["wake"] = t
        if ts is not None and kind not in NOT_LIVE_KINDS and not (kind == "stopped" and d.get("inferred") is True):
            wrote = _away_stamp(d.get("reconciledAt"))[0]
            st["live"].append(max(ts, wrote) if wrote is not None else ts)
    st["live"].sort()
    st["open"] = [d for d in lines[last + 1:] if d.get("kind") == "stopped" and d.get("cause") in OPEN_STOP_CAUSES]
    return st


def _live_before(live, t):
    """The latest live line strictly before `t`, or None."""
    before = [x for x in live if x < t]
    return before[-1] if before else None


def _evidence(st, mt, now):
    """The Mac's evidence that passes the window test (run_record.py's stop model): (boot, [(S, W)]). Evidence E passes
    when it falls after the last lead-entry (any E when there is none) and at or before now, the record names it not
    yet, and a live line precedes the stop it starts (L_B, the latest live line before the boot B; a sleep's S)."""
    def window(e):
        return (st["entry"] is None or st["entry"] < e) and e <= now and _ms(e) not in st["named"]
    boot = mt.get("boot")
    if boot is None or not window(boot) or _live_before(st["live"], boot) is None:
        boot = None
    sleeps = [(s, w) for s, w in mt.get("sleeps") or [] if window(w) and _live_before(st["live"], s) is not None]
    return boot, sleeps


def _stop_fields(cause, at, lines, **more):
    fields = {"cause": cause, "inferred": True, "calls": inflight_calls(lines, upto=at), "at": _zms(at)}
    fields.update({k: _zms(v) for k, v in more.items()})
    return fields


def cmd_record_entry(args) -> int:
    """The lead's entry into its loop (execute § 4.5 *Run record*): every stop the record does not hold yet, then one
    lead-entry (run_record.py's stop model). Step 1, the gap stop G this entry resumes from, first match: a pause that
    stands (no line; the entry says stop: pause); the open stop; --cause (inferred at L, the latest live line); a boot
    that passes the window test after L (mac-restart at L); a session other than the last lead-entry's, both known,
    unless --by heartbeat (dead-lead at L: a tick runs in the live lead's own cron, so the session it differs from is
    another session's entry, never a dead lead's); --by watchdog (watchdog at L). Step 2: every boot or sleep that
    passes the window test, that G did not take and that starts before G's start (or with no G) is written first, in
    `at` order (a boot at L_B, a sleep at S with its wake): evidence after G's start is inside G. Step 3: G's own
    stopped line, when new, then exactly one lead-entry {by, session?, stop?}. Every stopped line carries the calls in
    flight at its `at`. Before the record is read, once the skip passes and off --dry-run, it renews the lead's lease
    (_lease_write, by "entry"; p28-4), so a lapsed lead counts in the Trickle again from its first entry."""
    rollout_path = Path(os.path.expanduser(args.rollout))
    if not rollout_path.is_file():
        print(f"ERROR: record-entry: rollout note not found at {rollout_path}", file=sys.stderr)
        return 1
    try:
        note = Note(rollout_path)
    except (OSError, ValueError) as e:
        print(f"ERROR: record-entry: cannot read {rollout_path}: {e}", file=sys.stderr)
        return 1
    ro = rollout_path.stem
    why = _ledger_skip(note)
    if why:
        print(f"[skip] {ro}: {why}: no entry recorded")
        return 0
    now = _now(args)
    # The lead's lease (p28-4; execute away.md § The Trickle), renewed at every loop entry and heartbeat tick, before
    # the record is read, so an unreadable record still renews it. --dry-run writes none; a failure prints one
    # LEASE_WARN line.
    if not args.dry_run:
        _lease_write(ro, now, "entry")
    lines = _record_read(ro)
    if lines is None:
        print(f"run_record: warning: record-entry: the Run record of {ro} cannot be read; nothing recorded",
              file=sys.stderr)
        return 0
    session = args.session if args.session is not None else os.environ.get("CLAUDE_CODE_SESSION_ID")
    session = session or None
    st = _stop_state(lines)
    live = st["live"]
    last_live = live[-1] if live else None
    mt = machine_times(st["entry"] or (live[0] if live else now), now)
    boot, sleeps = _evidence(st, mt, now)
    gap = None   # {stop, start, fields (a new stopped line) or None}
    pause, pause_start = _pause_stands(note, lines)
    if pause:
        gap = {"stop": "pause", "start": pause_start, "fields": None}
    elif st["open"]:
        o = st["open"][-1]
        gap = {"stop": o["cause"], "start": _away_stamp(o.get("at"))[0] or _rec_ts(o), "fields": None}
    elif last_live is not None:
        if args.cause:
            gap = {"stop": args.cause, "fields": _stop_fields(args.cause, last_live, lines)}
        elif boot is not None and boot > last_live:
            gap = {"stop": "mac-restart", "fields": _stop_fields("mac-restart", last_live, lines, boot=boot)}
            boot = None   # G took it
        elif session and st["session"] and session != st["session"] and args.by != "heartbeat":
            # A tick runs in the live lead's own cron: a session change it sees is another session's entry, no death.
            gap = {"stop": "dead-lead", "fields": _stop_fields("dead-lead", last_live, lines)}
        elif args.by == "watchdog":
            gap = {"stop": "watchdog", "fields": _stop_fields("watchdog", last_live, lines)}
        if gap is not None and gap["fields"] is not None:
            gap["start"] = last_live
    earlier = []
    inside = lambda t: gap is not None and (gap["start"] is None or t >= gap["start"])  # noqa: E731
    if boot is not None and not inside(_live_before(live, boot)):
        lb = _live_before(live, boot)
        earlier.append((lb, _stop_fields("mac-restart", lb, lines, boot=boot)))
    for s, w in sleeps:
        if not inside(s):
            earlier.append((s, _stop_fields("mac-sleep", s, lines, wake=w)))
    earlier.sort(key=lambda e: e[0])
    writes = [f for _t, f in earlier] + ([gap["fields"]] if gap is not None and gap["fields"] is not None else [])
    said = []
    for fields in writes:
        _event(ro, "stopped", None, fields, args)
        said.append(f"stopped {fields['cause']} (inferred, at {fields['at']})")
    entry = {"by": args.by}
    if session:
        entry["session"] = session
    if gap is not None:
        entry["stop"] = gap["stop"]
    _event(ro, "lead-entry", None, entry, args)
    said.append(f"lead-entry by={args.by}" + (f" stop={gap['stop']}" if gap is not None else ""))
    print(f"{ro}: " + "; ".join(said) + (" (dry-run)" if args.dry_run else ""))
    return 0


def _record_sleeps(rollout, note, now, args):
    """`next`'s sleep line (run_record.py's stop writers): a sleep no entry follows, the rollout's last calls running
    through it, say. Off --dry-run, only when the record has a lead-entry, no pause stands and no stop is open, and
    kern.waketime is later than both the last lead-entry and the latest recorded wake (the cheap gate, so pmset is read
    at most once per wake): each sleep that passes the window test is a mac-sleep {at: S, wake: W, calls}. A mac-sleep
    closes itself, so `next` writes no lead-entry. Never raises."""
    try:
        lines = _record_read(rollout)
        if not lines:
            return
        st = _stop_state(lines)
        if st["entry"] is None or st["open"] or _pause_stands(note, lines)[0]:
            return
        since = max(t for t in (st["entry"], st["wake"]) if t is not None)
        mt = machine_times(since, now)
        if mt["wake"] is None or mt["wake"] <= since:
            return
        for s, w in _evidence(st, mt, now)[1]:
            _event(rollout, "stopped", None, _stop_fields("mac-sleep", s, lines, wake=w), args)
    except Exception:  # noqa: BLE001 — recording never breaks `next`
        return


# ---- active Integration time (p29-13): an Integration log line's `active=` -------------------------------------------
# An Integration's `duration=` is its wall time, so a usage-limit stall inside it reads as lane work (chorus-p80-1's
# 876 minutes held about 9.5 h of them). `active=` is the wall less the stalls inside the window: the stops the Run
# record logs, read by run_record.py's stop model (stop_spans), and the Mac's sleeps it does not hold yet
# (_unrecorded_sleeps), with the integrate call's journal gaps where no stop is logged.

# The stop causes during which the calls in flight do not run (run_record.py's stop model: a usage limit, a dead lead,
# a Mac restart and a Watchdog recovery kill them, a sleep suspends them). A halt carries them on, so it is no stall.
STALL_CAUSES = ("usage-limit", "dead-lead", "mac-restart", "mac-sleep", "watchdog")
STOP_ENDS = ("lead-entry", "paused")                            # a stop ends at the next of these, or a non-sleep stop
STOP_FALLBACK_ENDS = ("slot-taken", "lane-taken", "run-bound")  # ... with none of those, at the next of these
# A gap in the integrate call's journal shorter than this is the call's own launch or an agent hand-over (the stamp
# floors to its minute), never a stall: score.py's GRACE, the quiet a call's Slot still counts as running.
JOURNAL_GAP_MS = 30 * 60 * 1000


def stop_spans(lines) -> list:
    """Every `stopped` line of a Run record as {cause, start, end} (aware datetimes; end None while open),
    read by run_record.py's stop model, its one copy. The lines are read in ts order, file order breaking ties (an
    inferred line's ts is its write time, and its lead-entry follows it in the same write). A stop starts at its `at`,
    else its ts. A mac-sleep ends at its `wake`. Any other stop ends at the first later line that is a lead-entry or a
    paused line, or a stopped line that is no sleep (at that line's start); with none of those (a lead on a pre-p29-10
    Engine snapshot writes no lead-entry) at the first later slot-taken, lane-taken or run-bound; else it stays open.
    An end never precedes its start. Overlaps are kept: the sleep owns an overlap only for a reader that splits time by
    cause, and a union (_span_ms) reads it once either way. Each span also carries its `stopped` line's `reason` (a
    string, else "") and `index`, the line's position in `lines` (p29-7: `moving` reads an open halt's reason by it)."""
    seq = []
    for i, d in enumerate(lines or ()):
        ts = _rec_ts(d) if isinstance(d, dict) else None
        if ts is not None:
            seq.append((ts, i, d))
    seq.sort(key=lambda x: (x[0], x[1]))

    def start_of(ts, d):
        return _away_stamp(d.get("at"))[0] or ts

    out = []
    for k, (ts, i, d) in enumerate(seq):
        if d.get("kind") != "stopped":
            continue
        cause, start = d.get("cause"), start_of(ts, d)
        if cause == "mac-sleep":
            end = _away_stamp(d.get("wake"))[0]
        else:
            end = fallback = None
            for t2, _j, d2 in seq[k + 1:]:
                kind = d2.get("kind")
                if kind in STOP_ENDS:
                    end = t2
                    break
                if kind == "stopped" and d2.get("cause") != "mac-sleep":
                    end = start_of(t2, d2)
                    break
                if fallback is None and kind in STOP_FALLBACK_ENDS:
                    fallback = t2
            if end is None:
                end = fallback
        if end is not None and end < start:
            end = start
        reason = d.get("reason")
        out.append({"cause": cause, "start": start, "end": end, "reason": reason if isinstance(reason, str) else "",
                    "index": i})
    return out


def _union(spans, lo, hi) -> list:
    """The union of `spans` [(start, end or None)] (epoch ms) inside [lo, hi], as sorted disjoint [a, b]; an open one
    runs to hi."""
    out = []
    for a, b in sorted((max(a, lo), min(hi if b is None else b, hi)) for a, b in spans):
        if b <= a:
            continue
        if out and a <= out[-1][1]:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


def _span_ms(spans, lo, hi) -> int:
    """The milliseconds of the union of `spans` inside [lo, hi] (_union)."""
    return sum(b - a for a, b in _union(spans, lo, hi))


def _gaps(spans, lo, hi, least) -> list:
    """The spans of [lo, hi] that `spans` leave uncovered, as [(a, b)], only those of at least `least`."""
    gaps, at = [], lo
    for a, b in _union(spans, lo, hi):
        gaps.append((at, a))
        at = b
    gaps.append((at, hi))
    return [(a, b) for a, b in gaps if b - a >= least]


def _integrate_agents(lines, slug, lo, hi):
    """[(start, end)] (epoch ms) of the agents the integrate call's Workflow journal places in its own run, None when
    it cannot be read, and [] when it shows a resumed call whose agents were all replayed (so it places none). The call
    is the task's latest `run-bound` with call integrate stamped inside [lo, hi] (a Lost-call resume binds the same
    runId again); its journal <journalDir>/<runId>.json (fold-journals' path) must be an object naming that runId with
    a terminal status. A workflow_agent entry of its workflowProgress marked `cached: true` is skipped: a resumed call
    replays each agent that finished before the kill that way, stamped at the resume (its startedAt) with no
    durationMs, so it places no time in this run. Every other (live) one must carry startedAt and durationMs (epoch ms,
    ints >= 0), else the journal is refused (None): an agent it cannot place would read as a gap. A resumed call's
    journal so places only its last run's live agents, and the time before the first of them (the stall, the attempts
    it killed and the earlier run's work by the agents it replayed) reads as one gap: that run's work is counted as
    stall, never a stall as lane work."""
    key, bound = slug.lower(), None
    for d in lines:
        if d.get("kind") == "run-bound" and d.get("task") == key and d.get("call") == "integrate":
            ts = _rec_ts(d)
            if ts is not None and lo <= _ms(ts) <= hi:
                bound = d
    if bound is None:
        return None
    run_id, jdir = bound.get("runId"), bound.get("journalDir")
    if not isinstance(run_id, str) or not RUN_ID_RE.fullmatch(run_id) or ".." in run_id or not isinstance(jdir, str):
        return None
    jdir = os.path.expanduser(jdir)
    if not os.path.isabs(jdir):
        return None
    try:
        with open(os.path.join(jdir, run_id + ".json"), "rb") as f:
            journal = json.load(f)
    except (OSError, ValueError):
        return None
    if not isinstance(journal, dict) or journal.get("runId") != run_id or \
            journal.get("status") not in _run_record().TERMINAL_STATUSES:
        return None
    progress = journal.get("workflowProgress")
    agents = [a for a in progress if isinstance(a, dict) and a.get("type") == "workflow_agent"] \
        if isinstance(progress, list) else []
    out, replayed = [], 0
    for a in agents:
        if a.get("cached") is True:
            replayed += 1
            continue
        st, dur = a.get("startedAt"), a.get("durationMs")
        if not all(isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in (st, dur)):
            return None
        out.append((st, st + dur))
    if not out:
        return [] if replayed else None
    return out


def _unrecorded_sleeps(lines, now, until) -> list:
    """[(S, W)] (epoch ms): the Mac's sleeps its Run record does not name yet, read without writing (p29-13). The
    record's sleep writers are `next` (_record_sleeps), which runs only after the lead has reconciled a returned call
    or logged its own Integration (execute step 2, the Stop-hook driver's reconcile, integrate, merge, then `next`),
    and record-entry, at the next loop entry or 20-minute heartbeat tick. So a sleep inside an Integration is usually
    not in the record when its line is written, and an agent's durationMs holds the time the Mac slept, so no journal
    gap shows it either. These are the reads _record_sleeps
    makes: machine_times since the mark, the later of the last lead-entry and the latest recorded wake (with neither,
    the record's first live line: a record-entry would read from there), kept by _evidence's window test. Unlike
    _record_sleeps it reads through an open stop, a standing pause and a record with no lead-entry yet, which gate a
    write, not whether the Mac slept. [] with no live line, when `until` (epoch ms, the window's end) is not after
    the mark (a sleep the record does not name yet wakes after the mark, and the Mac was awake at it, so it starts
    after it too: nothing to read), or when the Mac's last wake is not after the mark."""
    st = _stop_state(lines)
    marks = [t for t in (st["entry"], st["wake"]) if t is not None]
    since = max(marks) if marks else (st["live"][0] if st["live"] else None)
    if since is None or _ms(since) >= until:
        return []
    mt = machine_times(since, now)
    if mt["wake"] is None or mt["wake"] <= since:
        return []
    return [(_ms(s), _ms(w)) for s, w in _evidence(st, mt, now)[1]]


def _active_minutes(rollout, slug, started, ended, wall, call, now) -> "int | None":
    """An Integration's `active=` (p29-13): its wall minutes (`duration=`) less the stalls inside its window, in whole
    minutes, never more than the wall; None (`active=-`) when the wall or the start is missing, the Run record cannot
    be read (no rollout, or an unreadable file), or the integrate call's journal is read and places no agent of its
    own run (a resumed call that only replayed, see below). The window runs from `started` to `ended` (the integrate
    row's finishedAt, the lead's --now) when that gives the wall's own minutes, else to started + wall. The stalls are
    the union, inside it, of the STALL_CAUSES stops of stop_spans(), the Mac's sleeps the record does not name yet
    (_unrecorded_sleeps, as of `now`: `next` writes them only after this line) and, where the record logs no such stop
    inside it and `call` (an integrate call's row), the integrate call's journal gaps (_integrate_agents: the spans of
    the window no live agent of the call ran in, each of at least JOURNAL_GAP_MS; a replayed, `cached`, agent places
    none, so a resumed call's earlier run reads as stall). With none of them, nothing comes off. It reads the record as
    it stands at the reconcile, before the row's own events."""
    if not isinstance(wall, int) or isinstance(wall, bool) or wall < 0 or not rollout:
        return None
    s = _iso_minutes(started)
    if s is None:
        return None
    lo = int(round(s * 60000))
    e = _iso_minutes(ended) if _whole_minutes(started, ended) == wall else None
    hi = int(round(e * 60000)) if e is not None else lo + wall * 60000
    lines = _record_read(rollout)
    if lines is None:
        return None
    stops = [(_ms(sp["start"]), None if sp["end"] is None else _ms(sp["end"]))
             for sp in stop_spans(lines) if sp["cause"] in STALL_CAUSES]
    spans = stops + _unrecorded_sleeps(lines, now, hi)
    if call and _span_ms(stops, lo, hi) == 0:
        agents = _integrate_agents(lines, slug, lo, hi)
        if agents == []:
            return None
        if agents:
            spans += _gaps(agents, lo, hi, JOURNAL_GAP_MS)
    return min(wall, max(0, (hi - lo) - _span_ms(spans, lo, hi)) // 60000)


def _latest_run(rollout, slug) -> dict:
    """{runId?, call?} of the task's latest run-bound in the record (quota-stall's, p29-10), {} with none."""
    lines = _record_read(rollout) or []
    key = (slug or "").lower()
    run = next((d for d in reversed(lines) if d.get("kind") == "run-bound" and d.get("task") == key), None)
    out = _call_entry(key, run)
    out.pop("task")
    return out


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


def _record_slot_taken(args, slug, note, rollout, start, cache, away_once):
    """mark-started's slot-taken. With no `rollout:`, no rollout note or no resolvable ceiling, one warning and
    nothing recorded (a Slot with no ceiling cannot be read against it). `cap` is the Mac-wide cap in force
    (_cap_in_force, p29-8): `away_once` reads the Away state at most once per verb run, silently (`next` prints its
    WARN), and only here, so --dry-run and a warned note never read it."""
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
    fields = {"settings": settings, "start": start, "cap": _cap_in_force(away_once())}
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


def _call_end(rollout, slug, now):
    """The end of the call whose row ends the task's Slot (p29-12), as the Workflow journal of that call records it (an
    aware UTC datetime), or None when it cannot be read: the caller then falls back to now and marks it. The call is
    read through the rollout's Run record by its reader rules: the task's open Slot is its first slot-taken since the
    last slot-freed (or from-file `carried`), a re-take while it is open being the same Slot, and the call is the last
    run-bound for the task inside it that is not an integrate call (a restart after a dead lead binds a newer one). Its
    journal, <journalDir>/<runId>.json (fold-journals' path), must be an object naming that runId with a terminal
    status. The end is startTime + durationMs (epoch ms, ints >= 0: score.py's reading), else the journal's
    `timestamp`, and must lie at or after the Slot's latest slot-taken, a re-take included, and at or before now (a
    later one is no end yet). An end before the latest slot-taken is not the end of the call the row reports: it is an
    earlier attempt's, a restart re-took the Slot after it (a launch that failed binds nothing new, and a resume that
    re-binds the same runId and errors leaves the old journal on disk), or another call's stale file. Stamped there,
    the row's slot-freed would sit before that slot-taken and split the Slot in two for every reader that reads the
    record by ts (score.py, the night record; run_record.py's call-end stamps): a second Slot that is never freed. A
    record, journal or field that cannot be read is None: never an error, no extra reason or warning line is printed,
    and the verb's exit is unchanged (p15-2). Whether the end is readable does decide the stamps: with none, the note's
    `ready:` (or a read-only approval's `merged:`) and the line's `ready=`/`merged=` are now, the line marked
    `(fallback)`, and the events `stamp: fallback`."""
    if not rollout:
        return None
    try:
        rr = _run_record()
        lines, _bad = _record_lines(rr.record_path(rollout))
    except Exception:
        return None  # no record yet, or one that cannot be resolved or read
    # `taken` is the open Slot (its first slot-taken); `floor` the latest slot-taken ts inside it, a re-take included
    key, taken, floor, bound = slug.lower(), None, None, None
    for d in lines:
        if d.get("task") != key:
            continue
        kind = d.get("kind")
        if kind == "slot-taken":
            if taken is None:
                taken, floor, bound = d, None, None
            at = _parse_ts(d.get("ts"))
            if at is not None and (floor is None or at > floor):
                floor = at
        elif kind == "slot-freed" or (kind == "carried" and d.get("rollout") == d.get("from")):
            taken, floor, bound = None, None, None
        elif kind == "run-bound" and taken is not None and d.get("call") != "integrate":
            bound = d
    if bound is None:  # no open Slot, or no call bound since it was taken
        return None
    run_id, jdir = bound.get("runId"), bound.get("journalDir")
    if not isinstance(run_id, str) or not RUN_ID_RE.fullmatch(run_id) or ".." in run_id or not isinstance(jdir, str):
        return None
    jdir = os.path.expanduser(jdir)
    if not os.path.isabs(jdir):
        return None
    try:
        with open(os.path.join(jdir, run_id + ".json"), "rb") as f:
            journal = json.load(f)
    except (OSError, ValueError):
        return None  # no journal yet (still in flight, or never written), or not JSON
    if not isinstance(journal, dict) or journal.get("runId") != run_id or \
            journal.get("status") not in rr.TERMINAL_STATUSES:
        return None  # another call's file, or a call that has not ended
    st, dur = journal.get("startTime"), journal.get("durationMs")
    end = None
    if all(isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in (st, dur)):
        try:
            end = datetime.fromtimestamp((st + dur) / 1000, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            end = None
    elif isinstance(journal.get("timestamp"), str):
        end = _parse_ts(journal["timestamp"])
    if end is None or end > now or (floor is not None and end < floor):
        return None
    return end


def _call_end_mark(ended, now):
    """(fields, ts) for an event that records a call's end (p29-12): at `ended` with `stamp: call-end` and the
    reconcile's own clock as `reconciledAt` (when the lead turned to the row), or, with no end read, `stamp: fallback`
    and ts None (the reconcile's clock, _event's default)."""
    if ended is None:
        return {"stamp": CALL_END_FALLBACK}, None
    return {"stamp": CALL_END_MARK, "reconciledAt": _utc_z(now, ms=True)}, ended.isoformat()


def _reconcile_events(args, rollout, slug, task, note, prior, held, lane_fields, note_status, pr, ready_stamped,
                      ended, now):
    """One row's events, against the note's status (`prior`), _holds_lane (`held`) and the Integration log's lane
    fields (`lane_fields`, for a lead row, which carries no `integration`) read before its writes. A row that ends a
    Slot is its call's end (p29-12): its slot-freed, ready, merged, set-aside and quota-stall (and its review-verdict
    events, _review_verdict_events) are stamped at `ended` (_call_end) with `stamp: call-end` and the reconcile's own
    clock as `reconciledAt`, or, with no end read, at the reconcile's clock with `stamp: fallback`
    (_call_end_mark); a ready or merged on any other row is a fallback too. The lane's events are the lead's (ADR
    0030): at the reconcile's clock, unmarked."""
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
    ends_slot = prior == "in_progress" and integ is None
    mark, end_ts = _call_end_mark(ended, now)
    slot_mark, slot_ts = (mark, end_ts) if ends_slot else ({}, None)
    if ends_slot:
        if note_status == "review" and pr:
            outcome_s = "ready"
        elif note_status == "done":
            outcome_s = "completed"
        elif failed:
            outcome_s = "lost"
        else:
            outcome_s = "set-aside"
        _event(rollout, "slot-freed", slug, {"outcome": outcome_s, **mark}, args, ts=end_ts)
    if ready_stamped:
        _event(rollout, "ready", slug, {**({"pr": pr} if pr else {}), **mark}, args, ts=end_ts)
    if note_status == "done" and prior != "done":
        _event(rollout, "merged", slug, {"readOnly": True, **mark}, args, ts=end_ts)
    rejected = integ is not None and outcome == "rejected"
    if held and not (integ is not None and outcome == "integrated"):
        fields = {"release": "reject" if rejected else "halt" if outcome == "void" else "set-aside"}
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
            "setAsideAt": at_after, **slot_mark}, args, ts=slot_ts)
        error_line = reason.split("\n", 1)[0].strip()
        if failed and QUOTA_RE.search(error_line):
            # p29-10: the call the limit killed, from the task's latest run-bound (omitted when it has none)
            _event(rollout, "quota-stall", slug,
                   {"stage": stage, "detail": error_line[:500], **_latest_run(rollout, slug), **slot_mark}, args,
                   ts=slot_ts)


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


def _review_verdict_events(args, rollout, slug, task, prior, ended, now):
    """p21-3: one review-verdict event per entry of an engine row's reviewVerdicts (each master-review round the call
    judged), written once per run_record.verdict_key: an entry whose key the record already holds for this task (a
    signed-gate or Lost-call resume replaying the stopped call's rounds) is skipped. Its head is resolved to a full
    sha in the task tree first (an abbreviated and a full head key alike); a head that is not 7-40 hex is dropped
    with a warning and never reaches git. A `changes` round is split original / regression by review-split.py
    against the task's first judged head (the record's earlier heads, then this row's); an approve is 0/0/0.
    Only for a row that ends a Slot (the note read in_progress) and carries no `integration` (an Integration
    re-review is no master-review round); nothing on --dry-run, with no rollout, or for a row without the key (a
    pre-p21-3 engine's, a lead-written one). Each round was judged inside the call, so it is stamped at the call's end
    (p29-12, _call_end_mark), never later. Best-effort: it never changes the verb's exit or stdout."""
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
        mark, end_ts = _call_end_mark(ended, now)
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
            _event(rollout, "review-verdict", slug, {**fields, **mark}, args, ts=end_ts)
            seen.add(key)
            if head:
                heads.append(head)
    except Exception as e:
        _rv_warn(slug, f"not recorded: {type(e).__name__}: {e}")


# ---- Flakes (ADR 0050, p29-9) ----------------------------------------------------------------------------------
# A Flake is a named test that failed a verifier run in a rollout outside the task's diff, then passed its named re-run
# and a confirming full run on the same tree. Each one is logged once per (task, sha, site) as a `flake` Run-record
# event and a line in the `## Flake log` of one follow-up task per (repo, test): `<project>-followup-flake-<h>`, h the
# first 10 hex of sha256(repo + "\n" + test). The follow-up is found by a glob of the Tasks root for a note that is not
# finished; a finished or archived one gets a fresh `-2`, `-3`. At its second line it is priority high and the repo's to
# fix. Two callers: reconcile (an engine row's `flakes`) and record-verify (the lead's Integration verify and RACE
# re-verify, from lead-integrate.py verify --diff-base's <out>.flake.json).
FLAKE_LOG_SECTION = "## Flake log"
FLAKE_TWICE_SECTION = "## The repo's to fix"
FLAKE_TEST_MAX = 300
FLAKE_SHA_RE = re.compile(r"[0-9a-f]{7,40}\Z")
FLAKE_CTRL_RE = re.compile(r"[\x00-\x1f\x7f]")
ORIGIN_SLUG_RE = re.compile(r"([^/:\s]+/[^/:\s]+?)(?:\.git)?/*$")


def _flake_entry(e):
    """(test, sha) for a well-formed Flake entry {test, sha}: test a non-empty one-line string of at most 300
    characters (stripped), sha 7-40 hex (lowercased); else None. The engine's flakesOf keeps the same rule."""
    if not isinstance(e, dict):
        return None
    test, sha = e.get("test"), e.get("sha")
    if not isinstance(test, str) or not isinstance(sha, str):
        return None
    test, sha = test.strip(), sha.strip().lower()
    if not test or len(test) > FLAKE_TEST_MAX or FLAKE_CTRL_RE.search(test) or not FLAKE_SHA_RE.match(sha):
        return None
    return test, sha


def _code(text):
    """`text` as one inline code span: a backtick run inside it gets a longer fence, padded, so a test id holding `]]`,
    `|` or backticks can never open a wikilink, a table cell or another span."""
    run = max((len(m) for m in re.findall(r"`+", text)), default=0)
    fence = "`" * (run + 1)
    pad = " " if run or text[:1] == " " or text[-1:] == " " else ""
    return f"{fence}{pad}{text}{pad}{fence}"


def _repo_identity(root, fallback):
    """The repo a Flake is filed for: `owner/name` from the Project root's origin URL, else the Project root's basename,
    else `fallback` (the task's project slug, when the rollout names no Project root)."""
    if root is None:
        return fallback
    try:
        p = subprocess.run(["git", "-C", str(root), "remote", "get-url", "origin"], capture_output=True, text=True,
                           timeout=30, env={k: v for k, v in os.environ.items() if not k.startswith("GIT_")})
        m = ORIGIN_SLUG_RE.search(p.stdout.strip()) if p.returncode == 0 else None
        if m:
            return m.group(1)
    except (OSError, subprocess.TimeoutExpired):
        pass
    return Path(root).name or fallback


def _flake_key(repo, test):
    return hashlib.sha256(f"{repo}\n{test}".encode("utf-8")).hexdigest()[:10]


def _flake_followup(tasks_dir, slug, h):
    """(path, True) for the open follow-up of key h in the Tasks root (glob `*-followup-flake-<h>*.md`, a note that is
    not done, merged or dropped), else (path, False) for the next free name: `<project>-followup-flake-<h>`, then -2, -3
    (a name a note in the Tasks root or its Archive holds is taken)."""
    stem_re = re.compile(rf".+-followup-flake-{h}(?:-\d+)?")
    for p in sorted(tasks_dir.glob(f"*-followup-flake-{h}*.md")):
        if not stem_re.fullmatch(p.stem):
            continue
        try:
            if _status(Note(p)) not in FINISHED_STATUSES:
                return p, True
        except (OSError, ValueError):
            continue
    base = _followup_name(slug, f"flake-{h}")
    k = 1
    while True:
        name = base if k == 1 else f"{base}-{k}"
        if _find_note(tasks_dir, name) is None:
            return tasks_dir / f"{name}.md", False
        k += 1


def _flake_twice_text(test, repo):
    return (f"{_code(test)} was logged as a Flake twice: it is {repo}'s to fix (ADR 0050). Fix it at its source in "
            f"{repo}; never inside a rollout task.")


def _flake_add(n, key, line, twice):
    """One Flake log line, unless a line already carries `key` ((task, sha12, site)); from the second line on, priority
    high and the twice section. Run through Note.apply, so a save replays it on a fresh read. True when it added one."""
    lines = [x.strip() for x in n.section_text(FLAKE_LOG_SECTION).split("\n")]
    if any(x.startswith("- ") and x.endswith(key) for x in lines):
        return False
    n.append_line(FLAKE_LOG_SECTION, line)
    if sum(1 for x in n.section_text(FLAKE_LOG_SECTION).split("\n") if x.strip().startswith("- ")) >= 2:
        n.set("priority", "high")
        n.upsert_section(FLAKE_TWICE_SECTION, twice)
    return True


def _flake_count(n):
    return sum(1 for x in n.section_text(FLAKE_LOG_SECTION).split("\n") if x.strip().startswith("- "))


def _write_flake_followup(path, note, test, repo, h, line, now):
    """File the follow-up for one test, in _new_task_fm's shape (projects copied from the task), its first Flake log line
    included. Exclusive: an existing file is never overwritten (FileExistsError)."""
    lines = [*_new_task_fm(note, now, "normal", [f'flake_key: "{h}"']), "",
             f"# Flake: {_code(test)} in {repo}", "", "## Notes", "",
             f"{_code(test)} failed a verifier run in a rollout of {repo} outside the task's diff, then passed its named "
             "re-run and a confirming full run on the same tree: the verify counted green and the test was logged as a "
             "Flake (ADR 0050). Fix it at its source in the repo, never inside a rollout task; a second line below "
             "makes it the repo's to fix.", "",
             f"- Test: {_code(test)}", f"- Repo: {repo}", "",
             FLAKE_LOG_SECTION, "", line]
    with open(path, "x") as fh:
        fh.write("\n".join(lines) + "\n")


def _rollout_root(tasks_dir, rollout, rollout_path=None):
    """The Project root of the rollout note (rollout_path, else <tasks-dir>/<rollout>.md or its Archive copy), or None."""
    path = rollout_path or (_find_note(tasks_dir, rollout) if rollout else None)
    try:
        return _project_root(Note(Path(path))) if path else None
    except (OSError, ValueError):
        return None


def _record_flakes(args, rollout, slug, note, flakes, site, tasks_dir, rollout_path=None):
    """Log each Flake (ADR 0050): one `## Flake log` line on its follow-up and, for each new line, one `flake` event.
    `flakes` is a list of {test, sha}; a malformed entry is a warning and skipped (_flake_entry). A line keyed (task,
    sha, site) that is already there writes nothing, so a re-run is a no-op. --dry-run writes nothing. Returns (stdout
    lines, warnings, errors): an error is a follow-up that could not be read or written."""
    out, warns, errs = [], [], []
    m = PHASED_STEM_RE.match(slug)
    project = m.group("slug") if m else slug
    repo = None
    now = _now(args)
    dry = getattr(args, "dry_run", False)
    for i, raw in enumerate(flakes, 1):
        e = _flake_entry(raw)
        if e is None:
            warns.append(f"{slug}: flakes entry {i} is malformed (test a one-line string of at most {FLAKE_TEST_MAX} "
                         "characters, sha 7-40 hex); skipped")
            continue
        test, sha = e
        if repo is None:
            repo = _repo_identity(_rollout_root(tasks_dir, rollout, rollout_path), project)
        h = _flake_key(repo, test)
        key = f"[[{slug}]] at {sha[:12]} ({site})"
        line = f"- {_stamp(now)} {key}"
        twice = _flake_twice_text(test, repo)
        path, found = _flake_followup(tasks_dir, slug, h)
        head = f"flake: {_code(test)} in {repo} at {sha[:12]} ([[{slug}]], {site})"
        if dry:
            out.append(f"{head} -> [[{path.stem}]]" + ("" if found else " (a new follow-up)") + " (dry-run)")
            continue
        added, created = False, False
        try:
            if not found:
                try:
                    _write_flake_followup(path, note, test, repo, h, line, now)
                    added = created = True
                except FileExistsError:
                    found = True   # another writer filed it meanwhile: append to theirs
            if not created:
                fu = Note(path)
                added = fu.apply(_flake_add, key, line, twice)
                fu.save()
                count = _flake_count(fu)
            else:
                count = 1
        except (OSError, ValueError) as ex:
            errs.append(f"{slug}: the Flake follow-up {path} could not be written: {ex}; this Flake is not logged")
            continue
        if not added:
            out.append(f"{head} -> [[{path.stem}]] already logged [no-change]")
            continue
        _event(rollout, "flake", slug, {"test": test, "repo": repo, "sha": sha, "site": site, "followup": path.stem,
                                        "count": count}, args)
        tail = " (filed)" if created else (f" (logged {count} times: the repo's to fix)" if count >= 2 else "")
        out.append(f"{head} -> [[{path.stem}]]{tail} [written]")
    return out, warns, errs


def _row_flakes(args, rollout, slug, task, note, tasks_dir, errors, warnings):
    """reconcile's side (p29-9): an engine row's `flakes`, a task call's (site task) or an integrator's (site integrate,
    a row with `integration`). Absent or null records nothing; a non-list is an error, nothing recorded. An integrate
    row reconciled with --no-verdict records none either, with one line saying why: a git-env trip fell inside the
    call's window, so a red its integrator saw may be the changed shared checkout's, and its re-runs prove nothing
    (the lead never runs record-verify after such a check either, execute § 4.5)."""
    flakes = task.get("flakes")
    if flakes is None or flakes == []:
        return []
    if getattr(args, "no_verdict", False) and task.get("integration") is not None:
        n = len(flakes) if isinstance(flakes, list) else 1
        return [f"{slug}: {n} Flake{'' if n == 1 else 's'} not recorded: --no-verdict (a git-env trip fell inside the "
                "integrate call's window, ADR 0053), so its verifier runs give no verdict, Flakes included"]
    if not isinstance(flakes, list):
        errors.append(f"{slug}: flakes is not a list ({type(flakes).__name__}) — no Flake recorded")
        return []
    site = "integrate" if task.get("integration") is not None else "task"
    lines, w, e = _record_flakes(args, rollout, slug, note, flakes, site, tasks_dir)
    warnings.extend(w)
    errors.extend(e)
    return lines


def _idle_reason(whole, paused, pause_requested, holds, queued, start, race_hold, set_aside, cap_held,
                 last_start_held, pr_held=False, task_pr_held=False, heat_held=False, main_red=()) -> str:
    """The idle-slots reason (the module docstring's table, first match). `whole`: the whole-rollout git-env trips (a bare
    checkout; a lane trip holds no Slot); `main_red`: `next`'s mainRed (a RACE revert that did not land). `cap_held`:
    this call holds a queued row on the Mac-wide cap, "trickle" (`trickle:`) or "away-cap" (`away cap:`), else None (a
    stalled row waits only on the ceiling); `last_start_held`: one on `last start:`. `pr_held`: the rollout's own
    hold_until stands (p30-3). `task_pr_held`: a task's own hold_until stands, on a queued, stalled or set-aside (at
    run or a gate) row. `heat_held`: one on `heat:` (the Heat hold, estate ADR 0009 d5), ahead of the Mac-wide cap."""
    if whole:
        return "hold-git-env"
    if main_red:
        return "hold-race"
    if paused or pause_requested:
        return "pause-drain"
    if heat_held:
        return "hold-heat"
    if cap_held:
        return "hold-away-cap" if cap_held == "away-cap" else "hold-trickle"
    if last_start_held:
        return "hold-last-start"
    if pr_held:
        return "hold-pr"
    starting = {id(r) for r in start}
    waiting = [r for r in queued if id(r) not in starting]
    waiting_ids = {id(r) for r in waiting}
    held = sorted(((r, why) for r, why in holds if id(r) in waiting_ids), key=lambda h: _rank(h[0]))
    if held:
        why = held[0][1]
        if why.startswith(HOLD_UNTIL_PREFIX):
            return "hold-pr"
        if why.startswith("depends on"):
            return "dependency"
        if why.startswith("solo") or why.startswith("behind solo"):
            return "solo"
    if task_pr_held:
        return "hold-pr"   # a stalled or set-aside task's own hold: it, not the queue's tail, keeps the Slot idle
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


def _lane_evidence(text) -> str:
    """lane-hold's evidence: the first non-empty line of `text`, whitespace collapsed, `[[` written as `[` (no wikilink
    on a Lane-log line but its own), cut to LANE_EVIDENCE_MAX characters; `(no message)` when there is none."""
    first = next((l for l in (text or "").splitlines() if l.strip()), "")
    first = " ".join(first.split()).replace("[[", "[")
    return first[:LANE_EVIDENCE_MAX] or "(no message)"


def cmd_lane_hold(args) -> int:
    """The Lane hold's one write (ADR 0048; execute § 4.5 *Lane hold*): `- <stamp> lane hold [[<slug>]] <cause>:
    <evidence>` on the rollout's `## Lane log`, the evidence on stdin, then the lane freed in the Run record
    (_halt_lane), when the record is unreadable or its lane is this task. A task note that cannot be read is no refusal
    when the rollout's `## Queue` links the slug (_queue_links): the hold must land exactly when the note will not
    parse, since `next` then no longer scans the task. Exit 2 usage; 1 the rollout note unreadable, the task another
    rollout's or no task of this one, or a failed save; an unacked hold with the same slug and cause writes nothing."""
    def error(msg, code=1):
        print(f"ERROR: lane-hold: {msg}; nothing written", file=sys.stderr)
        return code

    slugs = [s_.strip() for s_ in args.tasks.split(",") if s_.strip()]
    if len(slugs) != 1:
        return error("usage: --tasks takes one task slug", 2)
    if args.cause not in LANE_HOLD_CAUSES:
        return error(f"usage: --cause must be one of {', '.join(LANE_HOLD_CAUSES)}", 2)
    slug = _wikilink_slug(slugs[0]) or slugs[0]
    evidence = _lane_evidence(sys.stdin.read() if not sys.stdin.isatty() else "")
    rollout_path = Path(os.path.expanduser(args.rollout))
    if not rollout_path.is_file():
        return error(f"rollout note not found at {rollout_path}")
    try:
        rollout_note = Note(rollout_path)
    except (OSError, ValueError) as e:
        return error(f"cannot read {rollout_path}: {e}")
    ro = rollout_path.stem
    _path, note = _task_note(args, slug)
    unreadable = None
    if isinstance(note, str):
        unreadable = note
        if slug.lower() not in _queue_links(rollout_note):
            return error(f"{slug}: names no task of [[{ro}]] (its task note is unreadable: {note}, and the rollout's "
                         "## Queue does not link it)")
    elif (_note_rollout(note) or "").lower() != ro.lower():
        return error(f"{slug}: its rollout: is {note.get('rollout') or 'none'}, not [[{ro}]]")
    tail = f" (task note unreadable: {unreadable})" if unreadable else ""
    state = _record_state(ro) if not args.dry_run else None
    on_it = state is not None and state["lane"] == slug.lower()
    if any(h["slug"].lower() == slug.lower() and h["cause"] == args.cause for h in _lane_log_hold(rollout_note)):
        # A re-run after a save whose lane free never ran finishes it; nothing else is written.
        if on_it:
            _halt_lane(ro, slug, args, state)
        print(f"{slug}: lane hold ({args.cause}) [no-change]" + ("; lane freed" if on_it else "") + tail)
        return 0
    line = f"- {_stamp(_now(args))} lane hold [[{slug}]] {args.cause}: {evidence}"
    rollout_note.append_line(LANE_LOG_SECTION, line)
    try:
        rollout_note.save(dry_run=args.dry_run)
    except OSError as e:
        return error(f"cannot write {rollout_path}: {e}")
    if args.dry_run:
        print(f"{slug}: lane hold ({args.cause}) (dry-run){tail}")
        return 0
    try:
        landed = line in Note(rollout_path).section_text(LANE_LOG_SECTION).split("\n")
    except (OSError, ValueError):
        landed = False
    if not landed:
        print(f"ERROR: lane-hold: {slug}: the line is not on {rollout_path}'s {LANE_LOG_SECTION} on re-read", file=sys.stderr)
        return 1
    freed = state is None or on_it
    if freed:
        _halt_lane(ro, slug, args, state)
    print(f"{slug}: lane hold ({args.cause}) [written]; " + ("lane freed" if freed else "the record holds no lane on it")
          + tail)
    return 0


def cmd_lane_ack(args) -> int:
    """Lachy's ack of a Lane hold (repair § 3g, its one writer): `- <stamp> lane ack [[a]], [[b]]: <his words>` on the
    rollout's `## Lane log`. Reads no task note and writes no event. Exit 2 usage (no slug, an empty or multi-line
    --fix); 1 the rollout note unreadable, a slug no hold line names, or a failed save; every slug already acked writes
    nothing (`[no-change]`)."""
    def error(msg, code=1):
        print(f"ERROR: lane-ack: {msg}; nothing written", file=sys.stderr)
        return code

    slugs = [_wikilink_slug(s_.strip()) or s_.strip() for s_ in args.tasks.split(",") if s_.strip()]
    if not slugs:
        return error("usage: --tasks takes one or more task slugs", 2)
    fix = args.fix if args.fix is not None else ""
    if not fix.strip() or "\n" in fix or "\r" in fix:
        return error("usage: --fix takes one non-empty line, Lachy's words", 2)
    rollout_path = Path(os.path.expanduser(args.rollout))
    if not rollout_path.is_file():
        return error(f"rollout note not found at {rollout_path}")
    try:
        rollout_note = Note(rollout_path)
    except (OSError, ValueError) as e:
        return error(f"cannot read {rollout_path}: {e}")
    named = _lane_log_named(rollout_note)
    unknown = [s_ for s_ in slugs if s_.lower() not in named]
    if unknown:
        return error(f"no {LANE_LOG_SECTION} hold line names " + ", ".join(f"[[{s_}]]" for s_ in unknown))
    held = {h["slug"].lower() for h in _lane_log_hold(rollout_note)}
    if not any(s_.lower() in held for s_ in slugs):
        print(", ".join(slugs) + ": lane ack [no-change] (every hold is acked)")
        return 0
    line = f"- {_stamp(_now(args))} lane ack " + ", ".join(f"[[{s_}]]" for s_ in slugs) + f": {fix.strip()}"
    rollout_note.append_line(LANE_LOG_SECTION, line)
    try:
        rollout_note.save(dry_run=args.dry_run)
    except OSError as e:
        return error(f"cannot write {rollout_path}: {e}")
    print(", ".join(slugs) + ": lane ack" + (" (dry-run)" if args.dry_run else " [written]"))
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
# The calls a grade ruled for Lachy (ADR 0054 d3; estate-dispatch.py's DECIDED_HEADING): a record section, never a
# recorded human decision, so _recorded_decision never reads it.
DECIDED_SECTION = "## Decided for you"
# Record sections: never part of the brief the plan judge judges against.
BRIEF_EXCLUDE = ("## Plan-blocked feedback", "## Review-blocked feedback", "## Blocker diagnosis",
                 "## Review history", REPAIR_INPUT_SECTION, "## Scope decision", APPROVED_PLAN_SECTION,
                 INTEGRATION_LOG_SECTION, APPROVED_GATES_SECTION, GATE_PENDING_SECTION, NEEDS_HUMAN_SECTION,
                 "## Decisions", "## Resume prompt", "## Descope refused", DECIDED_SECTION)
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
    `## Approved gates` and `## Gated inputs (awaiting sign-off)`. A `## Decided for you…` section (DECIDED_SECTION) is
    an agent's call, never a recorded human decision, so it is never read here (ADR 0054)."""
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


def _new_task_fm(note, now, priority, extra):
    """The vault's new-task frontmatter (execute's completion ceremony), delimiters included: never `rollout:`,
    `phase:` or `owner:` (a loose task, never a phase member), `projects:` copied from `note`, then `extra` lines."""
    return ["---", "tags: [task]", "status: open", f"priority: {priority}", "work_depth: shallow",
            *_fm_block(note, "projects"), "contexts: []", "scheduled:", "due:",
            f"captured: {now.astimezone().date().isoformat()}", *extra, "---"]


def _write_followup(path: Path, note, slug, part, reason, run_n, now, clause):
    """File the follow-up: _new_task_fm's shape, `descoped_from:` naming the task."""
    lines = [*_new_task_fm(note, now, "normal", [f'descoped_from: "[[{slug}]]"']), "",
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
    _descope_pointer(note, part, part_f, run_n, owner, fu_name)
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
VERIFY_SLOT_PY = Path(__file__).resolve().parent / "verify-slot.py"
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


# The lead's own Integration set-asides that are the environment's, never the task's (ADR 0048, p29-7; execute § 4.5
# step 3's exit 8 and step 4's signal row): an origin outage, or a merge-task killed twice. Each cools down as infra.
# merge-task's exit-8 text stays `agent` (ADR 0033's tested contract).
INFRA_LEAD_OPENINGS = ("prepare: origin unreachable three times", "merge-task signalled twice")


def _retry_class(note) -> str:
    """How an automatic retry treats a block: `quota` (a dead call, `workflow call failed:`, whose error line reads as
    a usage or rate limit: QUOTA_RE), `infra` (the engine's TRANSIENT_DIAGNOSIS, any other dead call, or a lead-written
    Integration set-aside whose reason opens with one of INFRA_LEAD_OPENINGS) or `agent` (everything else: an agent
    can act on its feedback)."""
    kind, reason = _note_reason(note)
    first = reason.split("\n", 1)[0].strip()
    if first.lower().startswith(CALL_FAILED_PREFIX):
        return "quota" if QUOTA_RE.search(first) else "infra"
    if kind == "integration" and first.startswith(INFRA_LEAD_OPENINGS):
        return "infra"
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
    `error` names the first invalid stamp (`<key> on [[<note>]] must be an integer >= <min>, got '<raw>'`: H12, an
    execute § 6.5 (c) item, ADR 0048); `unresolved` is the resolver's words when it could not run (a refused
    rollouts.toml, a Project root that is gone): no retry, and no halt."""
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


# The two round budgets _retry_budget does not resolve (p29-7): the engine reads them, and an invalid stamp on a task
# is H12 (lead-integrate.py cause 16), never a halt (ADR 0048).
ROUND_BUDGET_ONLY_KEYS = ("max_iterations", "max_plan_rounds")


def _round_budget_error(note, rollout_note):
    """`<key> on [[<note>]] must be an integer >= 1, got '<raw>'` for the first invalid `max_iterations` or
    `max_plan_rounds` stamp, else None. Each key is read at the first level that carries it, task then rollout (an
    empty value counts as present, and is invalid); the resolver is never run, since a key absent at both levels
    resolves to a valid value."""
    for key in ROUND_BUDGET_ONLY_KEYS:
        for n in (note, rollout_note):
            raw = n.get(key) if n is not None else None
            if raw is None:
                continue
            if _stamp_value(raw, 1) is None:
                return f"{key} on [[{n.path.stem}]] must be an integer >= 1, got {raw!r}"
            break
    return None


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


@_journaled
def _descope_pointer(note, part, part_f, run_n, owner, fu_name):
    """The brief pointer, read from the note itself (journaled: Note.save re-applies it to a fresh read): on every item holding
    the part, else (an emergent part) one line in the first brief section."""
    lines, items, _fenced = _brief_items(note)
    hits = _part_hits(items, part_f)
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


@_journaled
def _rewrite_keys(note, pick, to):
    """Rewrite the key of each `## Repair input` entry `pick(fingerprint)` selects among the live ones to
    `(block <fp>; <to>)`, in memory (the caller saves; journaled, so Note.save re-applies it). Returns how many
    changed."""
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
    # An approved queue whose only marks are the Stage's ended room stops reads as never started (approved_unrun,
    # vault-grammar § Approved queue): its regenerate's carry, and § 0's interrupted finish, take it. --to keeps
    # never_started below.
    fresh, why = approved_unrun(src_note, linked)
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
    # An unacked Lane hold (ADR 0048): carry strips `integrating:` and never copies the `## Lane log`, so the held task
    # would integrate in the new rollout with no ack. Only his ack through /thread:repair § 3g releases it.
    lane_log = _lane_log_hold(src_note)
    if lane_log:
        names = ", ".join(dict.fromkeys(f"[[{h['slug']}]]" for h in lane_log))
        return refuse(f"--from {src.stem} holds an unacked Lane hold: {names}: record Lachy's ack first with "
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
    # The prior's own PR hold (p30-3; vault-grammar § Hold until), named with the parser `next` reads it by: a hold kept
    # only as prose was lost in a regenerate (Q50), so the carry copies it below. Printed in both modes.
    src_hold = _hold_until(src_note, _project_root(src_note))
    if src_hold is not None:
        print(f"{HOLD_KEY} unreadable: {src_hold['error']}" if src_hold["error"] else
              f"{HOLD_KEY} pr={src_hold['pr']} merged={src_hold['merged']}")
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
    # The hold first, before any task write: its lines verbatim (block form included, an unreadable one too, so it still
    # fails closed) after `parallel_ceiling:`, else `status:`, only while --to has none (Note.insert_block); an identical
    # one is left, a different one kept with a WARN. An interrupted re-run finds it there.
    if src_hold is not None:
        dst_lines = dst_note.fm_block(HOLD_KEY)
        if dst_lines is None:
            dst_note.insert_block(HOLD_KEY, src_hold["lines"], after=("parallel_ceiling", "status"))
            try:
                dst_note.save()
            except OSError as e:
                print(f"ERROR: carry: {dst.stem}: cannot write {dst}: {e} (no note carried yet)", file=sys.stderr)
                return 1
            written += 1
        elif dst_lines != src_hold["lines"]:
            print(f"WARN: carry: {HOLD_KEY} on {dst.stem} differs from {src.stem}'s; {dst.stem}'s kept", file=sys.stderr)
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


# ---- approve-queue and stamp-start (p30-4; vault-grammar § Approved queue) ----------------------------------------

def _queue_note(path: Path):
    """(Note, None) for an existing, parseable note, else (None, why) for a verb's refusal."""
    if not path.is_file():
        return None, f"rollout note not found at {path}"
    try:
        return Note(path), None
    except ValueError as e:
        return None, str(e)


def cmd_approve_queue(args) -> int:
    """Approve a queue on Lachy's words naming it and its gating PR: write `hold_until: {pr: <ref>, merged: true}`,
    `on_merge: regenerate` and `start: unattended` in one locked save, and print the one undo line. Refuses (exit 1,
    one ERROR line, nothing written) a note that is not found, serial, incomplete, closed, superseded or paused, one
    _approved_marks reads as run (room stops and an `integrating:` stamp do not refuse: the verdict judges them at the
    merge), an unreadable --pr, a standing hold on another PR (a bare-number one is told to become owner/repo#N) or an
    unreadable one, and an `on_merge:` of another value. A key already at its value is not rewritten. The undo line
    names `hold_until` only when this run wrote it."""
    def refuse(msg):
        print(f"ERROR: approve-queue: {msg}", file=sys.stderr)
        return 1

    path = Path(os.path.expanduser(args.rollout))
    note, why = _queue_note(path)
    if why:
        return refuse(why)
    stem = path.stem
    if _shape(note) == SHAPES[1]:
        return refuse(f"{stem}: shape: serial: a serial rollout runs as Legs and is never an approved queue")
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    linked, index = _scan(path, tasks_dir)
    why = incomplete(path, note, linked, index)
    if why:
        return refuse(f"{stem} is incomplete: {why}: /thread:schedule {_project(note) or '<project>'} --regenerate "
                      "first, then approve the new note")
    if _status(note) in CLOSED_ROLLOUT_STATUSES:
        return refuse(f"{stem} is {_status(note)}: a closed rollout runs nothing")
    if _valued(note.get("superseded_by")):
        return refuse(f"{stem} is superseded by [[{_link_slug(note, 'superseded_by')}]]: approve that note instead")
    if _valued(note.get("paused")) or _truthy_flag(note.get("pause_requested")):
        return refuse(f"{stem} is paused (or a pause is requested): only a queue nothing has run is approved")
    kind, detail = _approved_marks(note, linked)
    if kind == "run":
        return refuse(f"{stem}: it has run ({detail}): only a queue nothing has run is approved")
    pr = (args.pr or "").strip()
    repo_pr, url = HOLD_REPO_PR_RE.match(pr), PR_URL_RE.match(pr)
    if repo_pr:
        key = f"https://github.com/{repo_pr.group(1)}/pull/{repo_pr.group(2)}"
    elif url:
        key = f"https://github.com/{url.group(1)}/pull/{url.group(2)}"
    else:
        return refuse(f"--pr {pr or '<empty>'}: name the PR as owner/repo#N or its URL")
    hold = _hold_until(note, _project_root(note))
    if hold is not None and hold["error"] is not None:
        return refuse(f"{stem}: its {HOLD_KEY} is unreadable ({hold['error']}): fix or remove it first")
    if hold is not None and hold["key"] != key:
        # A bare number is read in the Project root, so it never matches a --pr, and --pr takes no bare number.
        fix = "rewrite it as owner/repo#N first, or remove it" if isinstance(hold["key"], tuple) else \
            "remove it first, or name its PR"
        return refuse(f"{stem}: its {HOLD_KEY} names {hold['pr']}, not {pr}: {fix}")
    om = _on_merge(note)
    if om is not None and om["error"] is not None:
        return refuse(f"{stem}: its {ON_MERGE_KEY}: reads {om['value'] or '<empty>'}: {ON_MERGE_BAD}")
    if hold is None:
        note.insert_block(HOLD_KEY, [f"{HOLD_KEY}: {{pr: {pr}, merged: true}}"], after=("parallel_ceiling", "status"))
    if om is None:
        note.insert_block(ON_MERGE_KEY, [f"{ON_MERGE_KEY}: {ON_MERGE_REGENERATE}"], after=(HOLD_KEY,), after_span=True)
    stamp = not _valued(note.get("started_unattended"))
    if stamp and not _start_unattended(note):
        note.set(START_KEY, START_UNATTENDED, after=("status",))
    try:
        note.save()
    except OSError as e:
        return refuse(f"{stem}: cannot write {path}: {e}; nothing written")
    shown = hold["pr"] if hold is not None else pr
    # A hold that stood before this run (his own, or an earlier run's: the note cannot say which) is never named, so
    # following the line never drops a hold he wrote; removing on_merge (and the start stamp) undoes the approval.
    named = ([] if hold is not None else [HOLD_KEY]) + [ON_MERGE_KEY] + ([f"{START_KEY}: {START_UNATTENDED}"] if stamp else [])
    keys = f"{', '.join(named[:-1])} and {named[-1]}" if len(named) > 1 else named[0]
    print(f"undo: remove {keys} from [[{stem}]] before {shown} merges, or pause [[{stem}]] once its lead runs")
    return 0


def cmd_stamp_start(args) -> int:
    """Under the chain (schedule step 8, after step 7.5): stamp `start: unattended` on the note the approved queue's
    regenerate just wrote, and print the one undo line. Refuses (exit 1, one ERROR line, nothing written) a note that
    is not found, serial, incomplete, closed, superseded, paused, not never started, already started by the Stage (a
    valued `started_unattended:`) or that supersedes nothing. A stamp already there is not rewritten."""
    def refuse(msg):
        print(f"ERROR: stamp-start: {msg}", file=sys.stderr)
        return 1

    path = Path(os.path.expanduser(args.rollout))
    note, why = _queue_note(path)
    if why:
        return refuse(why)
    stem = path.stem
    if _shape(note) == SHAPES[1]:
        return refuse(f"{stem}: shape: serial: the Stage never starts a serial note")
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    linked, index = _scan(path, tasks_dir)
    why = incomplete(path, note, linked, index)
    if why:
        return refuse(f"{stem} is incomplete: {why}: never start it as written")
    if _status(note) in CLOSED_ROLLOUT_STATUSES:
        return refuse(f"{stem} is {_status(note)}: a closed rollout runs nothing")
    if _valued(note.get("superseded_by")):
        return refuse(f"{stem} is superseded by [[{_link_slug(note, 'superseded_by')}]]")
    if _valued(note.get("paused")) or _truthy_flag(note.get("pause_requested")):
        return refuse(f"{stem} is paused (or a pause is requested): its reinstate is Lachy's")
    fresh, why = never_started(note, linked)
    if not fresh:
        return refuse(f"{stem} has run ({why}): a running queue needs no start stamp")
    if _valued(note.get("started_unattended")):
        return refuse(f"{stem} carries started_unattended: {_scalar(note.get('started_unattended'))}: the Stage "
                      "already started it")
    prior = _link_slug(note, "supersedes")
    if not prior:
        return refuse(f"{stem} supersedes nothing: only an approved queue's regenerate stamps its new note here")
    if not _start_unattended(note):
        note.set(START_KEY, START_UNATTENDED, after=("status",))
    try:
        note.save()
    except OSError as e:
        return refuse(f"{stem}: cannot write {path}: {e}; nothing written")
    entry = index.get(prior)
    hold = (_hold_until(entry[1], None) if entry is not None else None) or _hold_until(note, None)
    prior_name = entry[0].stem if entry is not None else _wikilink_slug(_scalar(note.get("supersedes")))
    shown = hold["pr"] if hold is not None and hold["pr"] else "its gating PR"
    print(f"undo: remove {START_KEY}: {START_UNATTENDED} from [[{stem}]] before the Stage starts it, or pause [[{stem}]] "
          f"once it runs; it superseded [[{prior_name}]] when {shown} merged")
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


def _standing_month_spend(text, month) -> Decimal:
    """The standing approvals one rollout note's text logs for `month` (YYYY-MM): the STANDING_SPEND_RE lines under
    every `## Needs-you log` heading (line.strip() equal to it), each to the next line starting `## ` (Note.section_text's
    bounds), summed. A line outside the section, of another month, or with the mark anywhere but right after its first
    wikilink (a push line quoting it) never counts."""
    total, on = Decimal(0), False
    for line in text.split("\n"):
        if line.strip() == NEEDS_YOU_LOG_SECTION:
            on = True
            continue
        if line.startswith("## "):
            on = False
            continue
        if on:
            m = STANDING_SPEND_RE.match(line)
            if m and m.group(1) == month:
                total += Decimal(m.group(2))
    return total


class _StandingLedger:
    """This calendar month's standing-approved spend for one approve-gates --standing call (p30-8, ADR 0034's
    2026-10-27 amendment), built once per call and used lazily: only a gate that first prices under its limit asks for
    it, so an off limit, a bounced note or an over-limit gate never reads or locks anything.

    spent() -> (Decimal, None) or (None, why). On first need it takes the standing-spend lock (_spend_lock_path; never
    on --dry-run) and holds it until close(), from the month read to the call's last save, then sums
    _standing_month_spend over the --rollout note and every file directly in the tasks dir, Archive/ and
    Archive/Rollouts/ whose name matches ROLLOUT_NOTE_NAME_RE (schedule step 6's names, `-N` ordinals included), each
    once by real path and read fresh from disk. A missing directory is skipped; a note that cannot be read, or a
    directory that exists but cannot be listed, is (None, why), cached, so every later gate asks with it. A lock not
    taken in time raises OSError, cached too, so every later slug that needs the month read fails at once with the same
    message; a slug that never needs it is still written or asked. add() keeps the call's own running total (on
    --dry-run too, so its lines read as a real run's), which spent() includes."""

    def __init__(self, tasks_dir, rollout_path, month, dry_run):
        self.tasks_dir, self.rollout_path = Path(tasks_dir), Path(rollout_path)
        self.month, self.dry_run = month, dry_run
        self._lock = self._lock_error = self._base = self._why = None
        self._added = Decimal(0)

    def _read(self):
        """(sum, None) over the month's notes, or (None, why) on the first one it cannot read."""
        files, seen = [], set()

        def take(path):
            real = os.path.realpath(str(path))
            if real not in seen:
                seen.add(real)
                files.append(path)

        take(self.rollout_path)
        for d in (self.tasks_dir, self.tasks_dir / "Archive", self.tasks_dir / "Archive" / "Rollouts"):
            try:
                names = sorted(os.listdir(d))
            except (FileNotFoundError, NotADirectoryError):
                continue   # no Archive yet: nothing there to sum
            except OSError as e:
                return None, f"cannot read {d} for this month's standing approvals ({e})"
            for name in names:
                if ROLLOUT_NOTE_NAME_RE.search(name) and (d / name).is_file():
                    take(d / name)
        total = Decimal(0)
        for path in files:
            try:
                text = Path(path).read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError) as e:
                return None, f"cannot read {path} for this month's standing approvals ({e})"
            total += _standing_month_spend(text, self.month)
        return total, None

    def spent(self):
        if self._lock_error is not None:
            raise OSError(self._lock_error)
        if self._base is None and self._why is None:
            if not self.dry_run and self._lock is None:
                lock = _note_lock(lock_path=_spend_lock_path(), label="standing-spend lock")
                try:
                    lock.__enter__()
                except OSError as e:
                    self._lock_error = str(e)
                    raise
                self._lock = lock
            self._base, self._why = self._read()
        if self._why:
            return None, self._why
        return self._base + self._added, None

    def add(self, usd):
        self._added += usd

    def close(self):
        if self._lock is not None:
            self._lock.__exit__(None, None, None)
            self._lock = None


def _month_why(month, total, limit, gi):
    """Why a gate the per-gate limit covers still asks: this month's standing approvals would pass the month line, the
    same resolved limit (inclusive, as covered() is)."""
    return (f"this month's ({month}) standing approvals would reach US${gi.format_usd(total)} with this gate, past the "
            f"US${gi.format_usd(limit['value'])} month line ({limit['source']})")


class _CredentialContext:
    """The repo's test-credential class and the rollout's env_bootstrap for one approve-gates --standing call (ADR
    0062), resolved lazily, once: only a credential gate on an unbounced note asks for it. get() -> {error, cls,
    source, boot, boot_err}: error is `rollout settings refused: <the resolver's words>` (exit 1 for each slug that
    needs it, nothing written for it); otherwise cls is rollouts.toml's `test_credentials` value (None with no class:
    no Project root, as on every serial note, no repo table, or no GitHub origin), and boot the rollout's
    `env_bootstrap` (_command_value), or boot_err its CompletionValueError's words, which each credential gate then
    asks with."""

    def __init__(self, rollout_note):
        self.rollout_note, self._ctx = rollout_note, None

    def get(self):
        if self._ctx is None:
            res = _resolved_settings(self.rollout_note)
            if res["settings"] is None:
                self._ctx = {"error": f"rollout settings refused: {res['error']}"}
            else:
                tc = res.get("test_credentials") or {"value": None, "source": "built-in"}
                try:
                    boot, boot_err = _command_value(self.rollout_note, ENV_BOOTSTRAP_KEY), None
                except CompletionValueError as e:
                    boot, boot_err = "", str(e)
                self._ctx = {"error": None, "cls": tc.get("value"), "source": tc.get("source") or "built-in",
                             "boot": boot, "boot_err": boot_err}
        return self._ctx


def _credential_verdict(g, ctx, gi):
    """{"covered", "names", "why"} for one credential gate under the test-credential class (ADR 0062): the reading
    first, so a gate no class could sign says why; then an env_bootstrap the reader refused; then the bootstrap
    refresh and the value proof (gated_inputs.credential_covered)."""
    reading = gi.credential_reading(g, ctx["cls"])
    if reading["names"] is None:
        return {"covered": False, "names": None, "why": reading["why"]}
    if ctx["boot_err"]:
        return {"covered": False, "names": reading["names"], "why": ctx["boot_err"]}
    return gi.credential_covered(g, ctx["cls"], ctx["boot"])


def _approve_standing(args) -> int:
    """approve-gates --standing (ADR 0034, ADR 0062; the module docstring): sign each pending gate the standing approval
    covers, leave the rest pending with an ASK line. A spend gate is covered when it prices within the resolved limit
    and, unless it is already in `## Approved gates`, when this calendar month's standing approvals (_StandingLedger,
    the month line, ADR 0034's 2026-10-27 amendment) stay within the same limit with it. A credential gate on a note
    the plan judge never bounced is covered when it reads as the repo's declared test credential, the rollout's
    env_bootstrap refreshes the declared file with a plain cp, and each key it names is in that file with its declared
    form (gated_inputs.credential_covered): no ledger, no month line, no Needs-you line, no spend lock, and the limit
    is never resolved for it, so the class is its own switch. The limit resolves lazily, at a slug's first gate that is
    not such a credential gate. A slug's new spend signings are logged in the rollout note's `## Needs-you log` first,
    then its task note is written, so a failure between the two over-counts (fails closed). Exit 0 every gate written,
    3 some left, 1 an error (a held standing-spend lock included)."""
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
    month = now.astimezone().strftime("%Y-%m")
    suffix = " (dry-run)" if args.dry_run else " [written]"
    errors, asked = [], False
    ledger = _StandingLedger(tasks_dir, rollout_path, month, args.dry_run)
    creds = _CredentialContext(rollout_note)
    try:
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
            # ADR 0038: a note the plan judge bounced went to sign-off on a plan it never approved; nothing on it is the
            # standing approval's to sign, whatever the gate prices. The heading alone counts (fail-closed: an emptied
            # section still refuses).
            bounced = note.has_heading(GATE_BOUNCE_SECTION)
            approved = {_norm_gate(l) for l in note.section_text(APPROVED_GATES_SECTION).split("\n") if l.strip()}
            # covered: (gate, annotation, detail); slug_err (the limit's, or the class's resolver error) and lock_err
            # stop the slug with nothing written.
            covered, left, logged, slug_new, lock_err, slug_err, limit = [], [], [], Decimal(0), None, None, None
            for g in gates:
                if not bounced and gi.gate_kind(g) == "credential":
                    # ADR 0062: a declared test credential, proved present in its file; it never reads the limit.
                    ctx = creds.get()
                    if ctx["error"]:
                        slug_err = ctx["error"]
                        break
                    cv = _credential_verdict(g, ctx, gi)
                    if not cv["covered"]:
                        left.append((g, cv["why"]))
                        continue
                    detail = (f"test credential {', '.join(cv['names'])} present in {ctx['cls']['file']}, "
                              f"{ctx['source']}")
                    covered.append((g, gi.credential_annotation(date, cv["names"], ctx["cls"]["file"], ctx["source"]),
                                    detail))
                    continue
                if limit is None:   # resolved lazily: a slug of credential gates alone never reads it (ADR 0062 d5)
                    limit, err = _standing_limit(note, rollout_note)
                    if err:
                        slug_err = err
                        break
                verdict = gi.covered(g, limit["value"])
                if bounced:
                    left.append((g, _bounce_why(verdict, gi)))
                    continue
                if not verdict["covered"]:
                    left.append((g, _ask_why(verdict, limit, gi)))
                    continue
                norm = _norm_gate(g)
                spend_ann = gi.annotation(date, verdict["usd"], limit["value"], limit["source"])
                spend_detail = (f"exposure US${gi.format_usd(verdict['usd'])} of US${gi.format_usd(limit['value'])}, "
                                f"{limit['source']}")
                if norm in approved:
                    covered.append((g, spend_ann, spend_detail))   # signed already, or listed twice: no month check, no log
                    continue
                # The month line (ADR 0034's 2026-10-27 amendment): this month's standing approvals, the earlier slugs
                # and gates of this call included, plus this gate, within the same limit.
                try:
                    spent, why = ledger.spent()
                except OSError as e:
                    lock_err = e
                    break
                if why:
                    left.append((g, why))
                    continue
                total = spent + slug_new + verdict["usd"]
                if total > limit["value"]:
                    left.append((g, _month_why(month, total, limit, gi)))
                    continue
                slug_new += verdict["usd"]
                approved.add(norm)
                covered.append((g, spend_ann, spend_detail))
                logged.append((g, verdict["usd"], spent + slug_new))
            if slug_err is not None:
                errors.append(f"{slug}: {slug_err}; nothing written")
                continue
            if lock_err is not None:
                errors.append(f"{slug}: {lock_err}; nothing written")
                continue
            if logged:
                # The month line's ledger first: a failure before the task note's save over-counts (fails closed). A
                # fresh read per slug, so a failed save's journal never replays into a later one.
                try:
                    rn = Note(rollout_path)
                    for g, usd, m in logged:
                        rn.append_line(NEEDS_YOU_LOG_SECTION,
                                       f"- {_stamp(now)} [[{slug}]] {STANDING_SPEND_MARK} US${gi.format_usd(usd)} (month to "
                                       f"date US${gi.format_usd(m)} of US${gi.format_usd(limit['value'])}, "
                                       f"{limit['source']}): {g}")
                    rn.save(dry_run=args.dry_run)
                except (OSError, ValueError) as e:
                    errors.append(f"{slug}: cannot log the standing approval in [[{rollout_path.stem}]]: {e}; "
                                  "nothing written")
                    continue
                ledger.add(slug_new)
            if covered:
                existing = [l for l in note.section_text(APPROVED_GATES_SECTION).split("\n") if l.strip()]
                have = {_norm_gate(l) for l in existing}
                for g, ann, _detail in covered:
                    if _norm_gate(g) not in have:
                        have.add(_norm_gate(g))
                        existing.append(f"- {g} {ann}")
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
                for g, _ann, detail in covered:
                    print(f"{slug}: gate approved under the standing approval: {g} ({detail})" + suffix)
                if not left:
                    print(f"{slug}: every gate signed under the standing approval -> {route}" + suffix)
            for g, why in left:
                print(f"ASK: {slug}: {g}: {why}")
                asked = True
    finally:
        ledger.close()
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
    max(60, 7200 - 600 - N), "verifySlot": {"script": <this script's sibling verify-slot.py>, "slots": V}}, exit 0:
    `verifySlot` is the engine's args.verifySlot, copied verbatim (execute § 4), and `verifySlot.slots` the machine's
    verify_slots. A bad verify_timeout or no note: one ERROR line on stderr, exit 1 (checked first). A completion key
    the completion verify's reader refuses (_completion_config): its ERROR line, exit 2. A refused rollouts.toml:
    `ERROR: rollout settings refused: …`, exit 3. No sibling verify-slot.py (p32-1): `ERROR: verify-timeout: <path>
    not found`, exit 4 (checked last). Either way the lead's entry writes nothing."""
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
    try:
        # The completion verify's keys, read at every entry, so a value its reader refuses halts before any work
        # runs, never only at the ceremony after every task merged. `named_rerun:` (p29-9) the same way.
        _completion_config(note)
        named = _named_rerun(note)
    except CompletionValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    slots, err = _verify_slots()
    if err:
        print(f"ERROR: rollout settings refused: {err}", file=sys.stderr)
        return 3
    # p32-1: the lead passes verifySlot.script to the engine verbatim, so a plugin install without its sibling
    # verify-slot.py halts here, at the entry, with nothing stamped (gate-pricer's sibling check, its own code).
    if not VERIFY_SLOT_PY.is_file():
        print(f"ERROR: verify-timeout: {VERIFY_SLOT_PY} not found", file=sys.stderr)
        return 4
    out = {"verifyTimeout": seconds, "harnessTimeoutMs": HARNESS_MAX_S * 1000, "slotWait": _slot_wait(seconds),
           "verifySlot": {"script": str(VERIFY_SLOT_PY), "slots": slots}}
    if named:
        out["namedRerun"] = named   # only when the note sets it, so a line for a note without it is unchanged
    print(json.dumps(out))
    return 0


# ---- record-verify (ADR 0050, p29-9) -------------------------------------------

RECORD_VERIFY_SITES = ("integration", "race")


def cmd_record_verify(args) -> int:
    """The lead's record of one Integration verify or RACE re-verify (execute § 4.5 step 3, the RACE procedure), run
    only after its canary check exited 0: lead-integrate.py verify --diff-base's <out>.flake.json (--from). Verdict
    `flake`: each Flake logged and filed (_record_flakes, site --site). A timeout: one `suite-timeout` event (load,
    ADR 0051). Anything else records nothing. Then `recorded: <stamp>` is written into the file (tmp + rename), so a
    second call is `[no-change]`. No file (a verify whose verifier never ran writes none): `nothing to record`, exit 0.
    An unreadable or malformed file, a task note not found or not of --rollout, or a follow-up that cannot be written:
    one ERROR line, exit 1, the file not stamped. --dry-run writes nothing."""
    src = Path(os.path.expanduser(args.from_))
    slug = args.tasks.strip()
    if not src.exists() and not src.is_symlink():
        # lead-integrate.py verify writes no Flake record when the verifier never ran (`noslot`, a failed
        # env_bootstrap), so the lead's record-verify after such a verify has nothing to read.
        print(f"{slug}: {args.site} verify wrote no {src.name} (the verifier never ran: noslot or a failed "
              "env_bootstrap): nothing to record")
        return 0
    try:
        rec = json.loads(src.read_text())
        if not isinstance(rec, dict) or rec.get("v") != 1 or rec.get("verdict") not in ("green", "flake", "red"):
            raise ValueError("not a verify Flake record (v 1, verdict green | flake | red)")
    except (OSError, ValueError) as e:
        print(f"ERROR: record-verify: {src}: {e}; nothing recorded", file=sys.stderr)
        return 1
    if rec.get("recorded"):
        print(f"{slug}: {args.site} verify at {str(rec.get('sha') or '')[:12]} already recorded {rec['recorded']} "
              "[no-change]")
        return 0
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    rollout_path = Path(os.path.expanduser(args.rollout))
    path = tasks_dir / f"{slug}.md"
    try:
        note = Note(path)
    except (OSError, ValueError) as e:
        print(f"ERROR: record-verify: {slug}: task note unreadable at {path}: {e}; nothing recorded", file=sys.stderr)
        return 1
    ro = rollout_path.stem
    if (_note_rollout(note) or "").lower() != ro.lower():
        print(f"ERROR: record-verify: {slug}: its rollout: is {note.get('rollout') or 'none'}, not [[{ro}]]; nothing "
              "recorded", file=sys.stderr)
        return 1
    out, warns, errs = [], [], []
    if rec["verdict"] == "flake":
        flakes = [{"test": x, "sha": rec.get("sha")} for x in (rec.get("flakes") or [])]
        out, warns, errs = _record_flakes(args, ro, slug, note, flakes, args.site, tasks_dir, rollout_path=rollout_path)
    timeout = rec.get("timeout")
    if isinstance(timeout, dict):
        fields = {"site": args.site, "run": timeout.get("run"), "seconds": timeout.get("seconds")}
        if isinstance(rec.get("sha"), str) and rec["sha"]:
            fields["sha"] = rec["sha"]
        _event(ro, "suite-timeout", slug, fields, args)
        out.append(f"suite-timeout: [[{slug}]] {args.site} verify's {timeout.get('run')} run hit its "
                   f"{timeout.get('seconds')}s deadline: logged as load (ADR 0051), never a Flake"
                   + (" (dry-run)" if args.dry_run else ""))
    for w in warns:
        print(f"WARNING: {w}", file=sys.stderr)
    for line in out:
        print(line)
    if errs:
        for e in errs:
            print(f"ERROR: record-verify: {e}", file=sys.stderr)
        return 1
    if not args.dry_run:
        try:
            rec["recorded"] = _stamp(_now(args))
            tmp = src.with_name(src.name + ".tmp")
            tmp.write_text(json.dumps(rec, ensure_ascii=False) + "\n")
            os.replace(tmp, src)
        except OSError as e:
            print(f"WARNING: record-verify: {src} not stamped recorded: {e}", file=sys.stderr)
    if not out:
        print(f"{slug}: {args.site} verify {rec['verdict']}" + (f" ({rec.get('why')})" if rec.get("why") else "")
              + ": nothing to record" + (" (dry-run)" if args.dry_run else ""))
    return 0


# ---- completion-verify (estate ADR 0009 d6, Chorus ADR 0107 d1, ADR 0052) -------

COMPLETION_VERIFIER_KEY = "completion_verifier"
COMPLETION_TIMEOUT_KEY = "completion_timeout"
ENV_BOOTSTRAP_KEY = "env_bootstrap"
DEFAULT_COMPLETION_TIMEOUT = 3600   # the full suite's own deadline, never verify_timeout (a fast tier's), ADR 0052
COMPLETION_VERIFY_SECTION = "## Completion verify log"
COMPLETION_RED_PREFIX = "completion-red-"   # never prefix-matches `<slug>-rollout-<date>*`, as phase-close-followup-
COMPLETION_KIND = "completion-verify"       # the canary window's kind; its slug is the rollout's own stem
# Every result a run is recorded as. `noslot`, `unrun`, `stopped` and `heat` are no verdict and move no attempt;
# `stopped` (verify's own signal: a hard pause, a room stop) is deliberate and `heat` (the Heat hold, estate ADR 0009
# d5: the Mac was too hot to run the suite) is meant, so neither ever counts toward the halt streak.
COMPLETION_DECIDED = ("green", "flake", "red")
COMPLETION_STREAK = ("noslot", "unrun")
COMPLETION_NO_VERDICT = (*COMPLETION_STREAK, "stopped", "heat")
COMPLETION_RESULTS = (*COMPLETION_DECIDED, "rerun", *COMPLETION_NO_VERDICT)
COMPLETION_HALT_STREAK = 3   # no-verdict runs in a row before the lead halts
COMPLETION_LINE_RE = re.compile(r"^- \S+ attempt (?P<n>[12]) at (?P<sha>[0-9a-f]{40}) rc (?P<rc>\S+) -> "
                                rf"(?P<result>{'|'.join(COMPLETION_RESULTS)})\b")
# verify --outcome's result beside <out>; the attempt's lock is _attempt_lock's, in the git dir.
ATTEMPT_LOCK_WAIT = 2.0      # seconds --run retries its lock, outlasting a reader's microsecond shared probe
ORIGIN_TIMEOUT = 120         # seconds for each origin read before verify (ls-remote, fetch): a hang is a halt
# read mode's --wait (ADR 0055): it fits inside the background command's 7200000 ms cap, and outlasts any attempt's
# verify under ADR 0052's budget (the slot wait plus completion_timeout fit 7200 - 600, the 60 s floor aside), so a
# lock still held at its end is a process to look at, never a suite still running.
COMPLETION_WAIT_S = HARNESS_MAX_S - 200
COMPLETION_WAIT_POLL = 2.0   # seconds between its reads; each probe holds a shared lock for microseconds
VERIFY_OUTCOME_SUFFIX = ".outcome.json"
VERIFY_OUTCOME_ENDED = ("running", "done", "deadline", "bootstrap", "signal", "noslot", "heat")  # lead-integrate.py's


def _run_id(dt, pid):
    """A verify run's id, `<YYYYmmddTHHMMSS>-<pid>`: lead-integrate.py's outcome and --run's own fallback."""
    return f"{dt.strftime('%Y%m%dT%H%M%S')}-{pid}"
DEFAULT_BRANCH_SH = Path(__file__).resolve().parent / "default-branch.sh"
# Best-effort failing-test ids for the fix task, one pattern per common runner; the log path always goes with them.
FAILING_ID_RES = (
    re.compile(r"^(?:FAILED|ERROR) (\S+)"),                    # pytest -rfE summary
    re.compile(r"^(?:FAIL|ERROR): (\S+ \([^)]+\))"),           # unittest
    re.compile(r"^not ok \d+ - (.+?)\s*(?:#.*)?$"),            # TAP, node --test
    re.compile(r"^\s*[✕✖] (.+?)(?: \(\d[\d.]*\s*m?s\))?$"),   # jest, node:test spec
    re.compile(r"^--- FAIL: (\S+)"),                           # go test
    re.compile(r"^test (\S+) \.\.\. FAILED$"),                 # cargo test
)
FAILING_IDS_MAX = 50


class CompletionValueError(ValueError):
    pass


def _continued(note, key):
    """True when the key's value goes on below its own line: the next line that is neither blank nor an indented
    comment is indented (YAML folds a plain scalar across blank and comment lines, and reads a value under an empty
    key)."""
    lines = note._fm
    i = next((n for n, line in enumerate(lines) if re.match(rf"^{re.escape(key)}:", line)), None)
    if i is None:
        return False
    # An indented comment is skipped like a blank line: YAML reads a value below it.
    nxt = next((line for line in lines[i + 1:] if line.strip() and not re.match(r"^[ \t]+#", line)), "")
    return bool(re.match(r"^[ \t]+\S", nxt))


def _command_value(note, key):
    """A frontmatter command (`completion_verifier:`, `env_bootstrap:`): '' when absent, empty, a comment alone,
    `null` or `~`. A quoted value is the text inside its quotes, then nothing but an optional ` # comment`; a bare one
    drops an inline ` # comment`, as every frontmatter scalar does, so a command holding ` #` is quoted. A form this
    reader cannot represent exactly raises CompletionValueError, refused, never truncated into another command: a
    value continued on an indented next line (a block scalar, a folded plain scalar, a command under an empty key),
    an escape inside double quotes, text after the closing quote, a bare value starting with a YAML indicator or
    `- `, or a bare value holding `: ` or ending in `:`."""
    raw = note.get(key)
    if raw is not None and _continued(note, key):
        raise CompletionValueError(f"{key}: continues on a later line; write the command on one line, quoted")
    raw = raw or ""
    if raw[:1] in ("'", '"'):
        q = raw[0]
        end = raw.find(q, 1)
        inner, rest = raw[1:end], raw[end + 1:]
        # A doubled '' or text after the quote fails the rest; a \ inside "" is an escape.
        if end < 0 or (q == '"' and "\\" in inner) or not re.fullmatch(r"(\s+#.*)?", rest):
            raise CompletionValueError(f"{key}: {raw!r} is not one plainly quoted command")
        cmd = inner.strip()
        if cmd.startswith("#"):
            raise CompletionValueError(f"{key}: {raw!r} is a comment, not a command: remove the key, or write the "
                                       "command")
    else:
        cmd = _drop_comment(raw).strip()
        try:
            shlex.split(cmd)
        except ValueError:
            # The ` #` cut fell inside the command's own shell quotes: what is left is another command.
            raise CompletionValueError(f"{key}: {raw!r} is not one shell command (a quote never closes, or a ` #` "
                                       "fell inside one): quote the whole command")
        if cmd and (cmd[0] in "|>[]{}&*!%@`,?" or re.match(r"-(\s|$)", cmd) or ": " in cmd or cmd.endswith(":")):
            raise CompletionValueError(f"{key}: {raw!r} is a YAML form, not a command: write the command on one "
                                       "line, quoted")
        if cmd.lower() in ("null", "~"):
            cmd = ""
        elif cmd.lower() in ("true", "false", "yes", "no", "on", "off"):
            raise CompletionValueError(f"{key}: {raw!r} is a YAML boolean, not a command: remove the key to turn it "
                                       "off, or quote a command")
    return cmd


def _completion_config(note):
    """(verifier, env_bootstrap, completion_timeout) for the completion verify, each read by its own reader, or
    ('', '', None) when the note declares no `completion_verifier:` (the other two are then never read). The one
    reader every caller uses: verify-timeout at each entry, the read and --run. CompletionValueError on a value a
    reader refuses."""
    verifier = _command_value(note, COMPLETION_VERIFIER_KEY)
    if not verifier:
        return "", "", None
    return verifier, _command_value(note, ENV_BOOTSTRAP_KEY), _completion_timeout(note)


def _completion_timeout(note):
    """`completion_timeout`, read by _verify_timeout under its own key, so a fast tier's verify_timeout never bounds
    the full suite (ADR 0052): absent, empty, a comment alone, `null` or `~` -> DEFAULT_COMPLETION_TIMEOUT, as the
    command keys read the same forms as none; anything else invalid -> CompletionValueError."""
    if _continued(note, COMPLETION_TIMEOUT_KEY):
        raise CompletionValueError(f"{COMPLETION_TIMEOUT_KEY}: continues on a later line; write the seconds on its "
                                   "own line")
    raw = note.get(COMPLETION_TIMEOUT_KEY)
    if not _valued(raw):
        return DEFAULT_COMPLETION_TIMEOUT   # empty, quoted empty, a comment alone (the template's line), null or ~
    seconds, err = _verify_timeout(note, COMPLETION_TIMEOUT_KEY)
    if err:
        raise CompletionValueError(err)
    return seconds


NAMED_RERUN_KEY = "named_rerun"
NAMED_RERUN_SLOT = "{tests}"


def _named_rerun(note):
    """The rollout's `named_rerun:` (ADR 0050, p29-9): the repo's own runner for named tests, holding `{tests}` exactly
    once, which lead-integrate.py verify --named-rerun replaces with the failing ids, each shell-quoted. Read by
    _command_value, so its forms are completion_verifier's; '' when absent (the lead's Flake check then leaves a red
    red). A value without `{tests}`, or with it twice, raises CompletionValueError."""
    cmd = _command_value(note, NAMED_RERUN_KEY)
    if cmd and cmd.count(NAMED_RERUN_SLOT) != 1:
        raise CompletionValueError(f"{NAMED_RERUN_KEY}: {cmd!r} must hold {NAMED_RERUN_SLOT} exactly once (where the "
                                   "failing tests go), e.g. \"scripts/test -n0 {tests}\"")
    return cmd


def _completion_lines(note):
    """The parsed `## Completion verify log` lines, oldest first; a line that does not parse is skipped."""
    out = []
    for line in note.section_text(COMPLETION_VERIFY_SECTION).split("\n"):
        m = COMPLETION_LINE_RE.match(line.strip())
        if m:
            out.append(dict(m.groupdict(), n=int(m.group("n"))))
    return out


def _completion_state(note):
    """(state, attempt, last, streak) from the note's parsed log lines (_completion_lines): `run` (no verdict yet: attempt 1 on a fresh
    origin/<default>, or a serial chain's checkout HEAD), `rerun` (attempt 1 was red: attempt 2 on its sha), or the
    decided `green`, `flake` or `red`.
    A no-verdict line moves nothing. last: the deciding line, or None; streak: the COMPLETION_STREAK lines at the
    log's tail, every other no-verdict one (`stopped`, `heat`) skipped."""
    lines = _completion_lines(note)
    streak = 0
    for d in reversed(lines):
        if d["result"] in COMPLETION_NO_VERDICT and d["result"] not in COMPLETION_STREAK:
            continue
        if d["result"] not in COMPLETION_STREAK:
            break
        streak += 1
    verdicts = [d for d in lines if d["result"] not in COMPLETION_NO_VERDICT]
    if not verdicts:
        return "run", 1, None, streak
    last = verdicts[-1]
    if last["result"] == "rerun":
        return "rerun", 2, last, streak
    return last["result"], last["n"], last, streak


def _completion_halts(result, streak):
    """True when this no-verdict run is the COMPLETION_HALT_STREAK-th in a row since the last halt: the streak
    restarts at each halt, so one transient no-verdict run after a resume never halts again at once."""
    return result in COMPLETION_STREAK and streak > 0 and streak % COMPLETION_HALT_STREAK == 0


def _failing_ids(lines, marker="== verifier:"):
    """Up to FAILING_IDS_MAX distinct failing-test ids read from the verify log's lines (an open file streams), in
    order, from verify's last `== verifier:` line to its `== verifier rc` line, so an env_bootstrap's own ERROR lines
    are never read as tests, nor a heat-stopped pass's run the Heat hold re-queued (lead-integrate.py verify: the log
    keeps every pass, and only the last is the verdict), nor the Flake check's named re-run and confirming run that
    follow the first run (lead-integrate.py verify --diff-base, ADR 0050); [] when none parse. marker=None reads from
    the first line (an agent suite's captured output, verify-slot.py run)."""
    ids = []
    reading = marker is None
    for line in lines:
        line = line.rstrip("\n")
        if marker is not None and line.startswith(marker):
            ids, reading = [], True   # a later pass's run (the Heat hold's re-queue): only the last one is read
            continue
        if not reading:
            continue
        if line.startswith("== verifier rc"):
            reading = False   # the run ended; a later `== verifier:` (a re-queued pass) starts over
            continue
        if len(ids) >= FAILING_IDS_MAX:
            continue
        for rx in FAILING_ID_RES:
            m = rx.match(line)
            if m and m.group(1) not in ids:
                ids.append(m.group(1))
                break
    return ids


# ---- the Flake check's placement (ADR 0050, p29-9) ----------------------------
# lead-integrate.py verify --diff-base reads the first run's failing ids (_failing_ids), then asks flake_verdict
# whether every one sits in a test file outside the task's diff: only then does it re-run them by name and confirm
# with one more full run. Pure: no git, no run; the caller passes the diff's paths (None when they could not be read).


def flake_file(test_id, tree):
    """The repo-relative test file a failing id names, or None when it names none: the id before any `::` (pytest's
    `path::name`), else the whole id. A path absolute inside the tree is made relative; a `..` part, a path outside the
    tree, a directory or a missing file is no test file (a node spec name, a TAP name, unittest's `name (mod.Class)`,
    a go or cargo id all land here)."""
    raw = str(test_id).split("::", 1)[0]
    if not raw or "\x00" in raw:
        return None
    root = os.path.realpath(str(tree))
    path = raw
    if os.path.isabs(path):
        for base in (str(tree), root):
            base = base.rstrip(os.sep)
            if path.startswith(base + os.sep):
                path = path[len(base) + 1:]
                break
        else:
            return None
    parts = [x for x in path.replace(os.sep, "/").split("/") if x not in ("", ".")]
    if not parts or ".." in parts:
        return None
    full = os.path.join(root, *parts)
    real = os.path.realpath(full)
    if not (real == root or real.startswith(root + os.sep)) or not os.path.isfile(full):
        return None
    return "/".join(parts)


def flake_verdict(ids, tree, diff_files):
    """The Flake check's placement of a red's failing ids, first match: no id -> `unnamed` (a timeout, a lint,
    typecheck or build step); FAILING_IDS_MAX ids -> `too-many` (the parser's cap: not every failure is seen); an id
    flake_file places in no test file -> `unplaced`; diff_files None (the diff could not be read) -> `diff`; an id whose
    file the diff changes -> `touched`; else `candidates`, the only verdict that re-runs. Returns {verdict, files: {id:
    file or None}, touched: [ids], unplaced: [ids]}."""
    ids = list(ids)
    files = {i: flake_file(i, tree) for i in ids}
    unplaced = [i for i in ids if files[i] is None]
    touched = [i for i in ids if files[i] is not None and diff_files is not None and files[i] in diff_files]
    if not ids:
        verdict = "unnamed"
    elif len(ids) >= FAILING_IDS_MAX:
        verdict = "too-many"
    elif unplaced:
        verdict = "unplaced"
    elif diff_files is None:
        verdict = "diff"
    elif touched:
        verdict = "touched"
    else:
        verdict = "candidates"
    return {"verdict": verdict, "files": files, "touched": touched, "unplaced": unplaced}


def _completion_tree_dir() -> Path:
    """Where a serial chain's detached verify trees live (ADR 0055), outside every working tree:
    THREAD_COMPLETION_TREE_DIR when it is absolute, else XDG_STATE_HOME (absolute)/thread/completion-trees, else
    ~/.local/state/thread/completion-trees; a relative value is ignored, as _note_lock_dir's rule reads."""
    absolute = lambda v: v if v and os.path.isabs(v) else None   # noqa: E731  a relative dir is ignored (the XDG rule)
    base = absolute(os.environ.get("THREAD_COMPLETION_TREE_DIR")) or os.path.join(
        absolute(os.environ.get("XDG_STATE_HOME")) or os.path.join(os.path.expanduser("~"), ".local", "state"),
        "thread", "completion-trees")
    return Path(base)


def _completion_paths(root, ro, attempt, serial=False):
    """(tree, out) for one attempt: its own detached tree and its own files. A parallel rollout's sit in its Project
    root, under `.claude/`. A serial chain's (ADR 0055) sit outside the in-place checkout's working tree, so a peer's
    `git add -A` there never stages them: the tree under _completion_tree_dir, the out beside the attempt's lock in the
    git common dir (None when that dir cannot be read: --run then refuses on the lock)."""
    # Built here, never through lead-integrate.py's worktree_dir: the read verb must not load it (it pulls in
    # verify-slot.py, which needs fcntl), so it still runs on the Windows machine.
    if serial:
        common = _git_common_dir(root)
        return (str(_completion_tree_dir() / f"completion-{ro}-{attempt}"),
                str(common / "thread" / f"completion-{ro}-{attempt}") if common else None)
    return (str(root / ".claude" / "worktrees" / f"completion-{ro}-{attempt}"),
            str(root / ".claude" / "integration" / f"completion-{ro}-{attempt}"))


def _git_common_dir(root):
    """The repo's git common dir as an absolute Path (`git rev-parse --path-format=absolute --git-common-dir`, bounded
    by 60 s, git's env scrubbed), or None when it cannot be read."""
    try:
        p = subprocess.run(["git", "-C", str(root), "rev-parse", "--path-format=absolute", "--git-common-dir"],
                           capture_output=True, text=True, timeout=60,
                           env={k: v for k, v in os.environ.items() if not k.startswith("GIT_")})  # GIT_DIR beats -C
    except (OSError, subprocess.TimeoutExpired):
        return None
    d = p.stdout.strip()
    return Path(d) if p.returncode == 0 and d else None


def _attempt_lock(root, ro, attempt):
    """The attempt's lock file, `<git common dir>/thread/completion-<rollout>-<n>.lock`: inside the repo's git dir, so
    an agent's `git clean` or `rm -rf .claude` in the shared checkout never deletes it under a live run. None when
    the git dir cannot be read."""
    d = _git_common_dir(root)
    return d / "thread" / f"completion-{ro}-{attempt}.lock" if d else None


# ---- a serial chain's completion verify (ADR 0055) ---------------------------------------------------------------
SERIAL_CHAINS_PY = Path(__file__).resolve().parent.parent.parent / "_shared" / "scripts" / "serial-chains.py"
_SERIAL_CHAINS = None


def _serial_chains():
    """serial-chains.py, loaded on first use (the _run_record() pattern), for its surface grammar: read_surfaces and
    parse_token. Its import has no side effects."""
    global _SERIAL_CHAINS
    if _SERIAL_CHAINS is None:
        sys.dont_write_bytecode = True
        spec = importlib.util.spec_from_file_location("thread_serial_chains", SERIAL_CHAINS_PY)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _SERIAL_CHAINS = mod
    return _SERIAL_CHAINS


def _serial_root(note):
    """(root, None) for a serial note's completion verify: its one `repo:` surface, which must be a git toplevel
    (`git -C <token> rev-parse --show-toplevel`, realpath'd, is the token's realpath: the test leg.py's claim stamps a
    `leg_base` by); else (None, why)."""
    sc = _serial_chains()
    repos = []
    for raw in sc.read_surfaces(note):
        try:
            kind, value = sc.parse_token(raw)
        except ValueError:
            continue
        if kind == "repo" and value not in repos:
            repos.append(value)
    if len(repos) != 1:
        return None, (f"a serial chain's completion verify runs on exactly one `repo:` surface, and {note.path.stem}'s "
                      f"surfaces: holds {len(repos)}" + (f" ({', '.join(repos)})" if repos else ""))
    tok = os.path.realpath(repos[0])
    try:
        p = subprocess.run(["git", "-C", tok, "rev-parse", "--show-toplevel"], capture_output=True, text=True,
                           timeout=60, env={k: v for k, v in os.environ.items() if not k.startswith("GIT_")})
        top = os.path.realpath(p.stdout.strip()) if p.returncode == 0 and p.stdout.strip() else None
    except (OSError, subprocess.TimeoutExpired):
        top = None
    if top != tok:
        return None, (f"repo:{repos[0]} is not a git toplevel (git -C {repos[0]} rev-parse --show-toplevel gives "
                      f"{top or 'no checkout'}): a serial chain's completion verify runs on its checkout's toplevel")
    return Path(tok), None


def _leg_tops(note, key):
    """[(top, sha)] from a task note's `leg_base:` or `leg_head:` list of `"<toplevel>@<sha>"` items (leg.py claim and
    done): the one parser of both; an item that is not `<top>@<7-40 hex>` is skipped."""
    out = []
    for item in note.get_list(key):
        top, sep, sha = item.rpartition("@")
        if sep and top and re.fullmatch(r"[0-9a-f]{7,40}", sha):
            out.append((top, sha))
    return out


def _chain_holds(li, root, sha, rollout_path, tasks_dir):
    """None when the commit `sha` holds the serial chain's work in `root`, else why not (ADR 0055). Every done linked
    task (the `rollout:` backlink, Archive included) with a `leg_base` entry for root anchors it: its `leg_head` entry
    there (its own newest trailered commit; none when it committed nothing there, `leg_head: []`), or, with no
    `leg_head:` key at all (a task done before ADR 0055), its `leg_base` entry. Each anchor must resolve and be an
    ancestor of sha; none at all passes. No such task means root is not one of the chain's checkouts."""
    root_s = str(root)
    anchors, seen = [], False
    for path, note in _linked_task_notes(rollout_path, tasks_dir):
        if _status(note) != "done":
            continue
        bases = [s for t, s in _leg_tops(note, "leg_base") if t == root_s]
        if not bases:
            continue
        seen = True
        if note.get("leg_head") is not None:
            anchors += [(path.stem, "leg_head", s) for t, s in _leg_tops(note, "leg_head") if t == root_s]
        else:
            anchors += [(path.stem, "leg_base", s) for s in bases]
    if not seen:
        return (f"{root} is not one of [[{rollout_path.stem}]]'s chain checkouts: no done task has a leg_base there")
    for task, key, anchor in anchors:
        full = li.rev(root, anchor)
        if not full or li.git(root, "merge-base", "--is-ancestor", full, sha).returncode != 0:
            return (f"HEAD of {root} ({sha[:12]}) does not hold the chain's commits: [[{task}]]'s {key} {anchor[:12]} "
                    "is not in it")
    return None


def _attempt_running(lock) -> bool:
    """True while a `completion-verify --run` holds the attempt's lock (_attempt_lock; for the attempt's whole life,
    the kernel drops it on any death). Probed shared, so two readers never see each other as a run (a --run starting
    meanwhile retries for ATTEMPT_LOCK_WAIT); released by the close, never LOCK_UN. No lock path, a lock that cannot
    be opened, or no fcntl (Windows, where --run refuses), reads as not running."""
    if fcntl is None or lock is None or not lock.exists():
        return False
    try:
        with open(lock, "a") as fh:
            try:
                fcntl.flock(fh, fcntl.LOCK_SH | fcntl.LOCK_NB)
            except (BlockingIOError, PermissionError):
                return True
    except OSError:
        return False
    return False


def _completion_summary(state, last, verifier, followup):
    """The Completion log's one line for a decided completion verify, or None while it is undecided."""
    if state not in COMPLETION_DECIDED:
        return None
    sha = last["sha"][:12]
    if state == "green":
        return f"Completion verify: green at {sha} (`{verifier}`)"
    if state == "flake":
        return f"Completion verify: flake at {sha}: attempt 1 red, attempt 2 on the same tree green; no task"
    tail = f"; fix task [[{followup}]]" if followup else ""
    return f"Completion verify: red at {sha} (rc {last['rc']}, attempt {last['n']}){tail}"


def _find_note(tasks_dir: Path, stem: str):
    """The path of `<stem>.md` in tasks_dir's root, else anywhere under its Archive/, else None."""
    root = tasks_dir / f"{stem}.md"
    if root.exists():
        return root
    archive = tasks_dir / "Archive"
    return next(archive.rglob(f"{stem}.md"), None) if archive.is_dir() else None


def _write_completion_red(path: Path, note, ro, verifier, sha, rc, why, log, ids, now, chain_root=None):
    """File the one fix task a red completion verify owes its project, in _new_task_fm's shape. Exclusive: an
    existing file is never overwritten. A serial chain's (chain_root, its checkout: ADR 0055) names that checkout, never
    merged main or an Integration, which a chain has neither of."""
    if chain_root is None:
        where = "on merged main"
        said = (f"rc {rc}, {why}. Every task merged green at its own Integration: the break is one their fast tiers "
                "did not reach.")
        verify = f"**Verify:** `{verifier}` exits 0 on merged main."
    else:
        where = f"on the chain's checkout `{chain_root}`"
        said = (f"rc {rc}, {why}. Each task passed its own Leg verify: the break is one their **Verify:** lines did "
                "not reach.")
        verify = f"**Verify:** `{verifier}` exits 0 on the chain's checkout."
    lines = [*_new_task_fm(note, now, "high", [f'completion_red_of: "[[{ro}]]"']), "",
             f"# Fix the red completion verifier after [[{ro}]]", "", "## Notes", "",
             f"The completion verifier `{verifier}` was red {where} at `{sha}` when [[{ro}]] completed: {said}", "",
             f"- Log: `{log}`",
             "- Failing ids: " + (", ".join(f"`{i}`" for i in ids) if ids else "none read from the log; read it"), "",
             verify]
    with open(path, "x") as fh:
        fh.write("\n".join(lines) + "\n")


def _classify_completion(outcome, attempt):
    """(result, why) for one finished run, from verify's structured outcome alone (never its log's text); None (no
    readable outcome file) is a verify that never got going."""
    if outcome is None:
        return "unrun", "verify left no outcome (it refused or died before its run), no verdict: the attempt re-runs"
    ended, rc, step = outcome.get("ended"), outcome.get("rc"), outcome.get("step")
    if ended == "running":
        return "unrun", "verify never finished (no final outcome), no verdict: the attempt re-runs"
    if ended == "noslot":
        return "noslot", "no verify slot in time, no verdict: it retries at the next tick"
    if ended == "heat":
        return "heat", "the Mac was too hot to run the suite (a Heat hold), no verdict: it retries at the next tick"
    if ended == "signal":
        return "stopped", f"verify was stopped by signal {outcome.get('signal')}, no verdict: the attempt re-runs"
    if ended == "bootstrap" or (ended == "deadline" and step != "verifier"):
        return "unrun", f"the {step or 'env_bootstrap'} never let the suite run ({ended}), no verdict: the attempt re-runs"
    if ended == "deadline":
        return "red", ("the completion verify's own `completion_timeout` deadline, red at once: a timeout names no "
                       "failing test, so it is never a Flake; the env_bootstrap and the suite together are over "
                       "their budget, or the suite hung")
    if rc == 0:
        return (("green", "the completion verifier passed") if attempt == 1 else
                ("flake", "attempt 1's red cleared on the same tree: a Flake, no task"))
    if attempt == 2:
        return "red", "red on its run and on a re-run of the same tree, so it is no Flake"
    return "rerun", "red: attempt 2 re-runs this tree"


def _read_outcome(path: Path):
    """verify's outcome file as a dict with a string id and a known `ended`, else None."""
    try:
        d = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    if not (isinstance(d, dict) and isinstance(d.get("id"), str) and re.fullmatch(r"[\w.-]+", d["id"])
            and d.get("ended") in VERIFY_OUTCOME_ENDED):
        return None
    return d


def _completion_not_ran(state, attempt, streak, **extra):
    """--run's line when it ran nothing: decided already, another --run holds the attempt, or a refusal."""
    print(json.dumps(dict(ran=False, state=state, result=state if state in COMPLETION_DECIDED else None,
                          decided=state in COMPLETION_DECIDED, attempt=attempt, streak=streak, halt=False, **extra)))


def _completion_run(args, path, ro, root, tasks_dir, serial=False) -> int:
    """--run (ADR 0052): one attempt end to end, under the attempt's lock (_attempt_lock), held for this process's
    life. serial (ADR 0055): a serial chain's, on its checkout's HEAD: no origin read and no git-env canary, and the
    HEAD guard (_chain_holds) before anything runs."""
    started = time.monotonic()
    if fcntl is None:
        print("ERROR: completion-verify: --run needs fcntl (POSIX); nothing run", file=sys.stderr)
        return 1
    note = Note(path)
    state, attempt, last, streak = _completion_state(note)
    if state in COMPLETION_DECIDED:
        _completion_not_ran(state, attempt, streak)
        return 0
    tree, out = _completion_paths(root, ro, attempt, serial)
    lock_path = _attempt_lock(root, ro, attempt)
    if lock_path is None or out is None:
        print(f"ERROR: completion-verify: {root}'s git dir is unreadable; nothing run", file=sys.stderr)
        return 1
    try:
        Path(out).parent.mkdir(parents=True, exist_ok=True)
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        lock = open(lock_path, "a")   # never closed by hand: the process's end releases it
    except OSError as e:
        print(f"ERROR: completion-verify: {e}; nothing run", file=sys.stderr)
        return 1
    deadline = time.monotonic() + ATTEMPT_LOCK_WAIT
    while True:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except (BlockingIOError, PermissionError):
            # A reader's shared probe lasts microseconds; only another --run holds the lock past the wait.
            if time.monotonic() >= deadline:
                print(f"ERROR: completion-verify: attempt {attempt} is in flight (another --run holds {lock_path}); "
                      "nothing run", file=sys.stderr)
                _completion_not_ran("in-flight", attempt, streak)
                return 3
            time.sleep(0.05)
    # Read again under the lock: another --run may have recorded this attempt just before it let go.
    note = Note(path)
    state2, attempt2, last, streak = _completion_state(note)
    if (state2, attempt2) != (state, attempt):
        _completion_not_ran(state2, attempt2, streak)
        return 0
    try:
        verifier, bootstrap, timeout = _completion_config(note)
    except CompletionValueError as e:
        print(f"ERROR: completion-verify: {e}; nothing run", file=sys.stderr)
        return 2
    if not verifier:   # removed between the read and the lock
        print(f"ERROR: completion-verify: {ro} declares no {COMPLETION_VERIFIER_KEY}:; nothing run", file=sys.stderr)
        return 2
    slots, err = _verify_slots()
    if err:
        print(f"ERROR: completion-verify: rollout settings refused: {err}; nothing run", file=sys.stderr)
        return 1
    li = _lead()
    # sig: the stop, once one lands; reading: the origin read in flight; verify: once started; forwarded: a stop
    # reached a live verify, and only then is the run `stopped`.
    st = types.SimpleNamespace(sig=None, reading=None, verify=None, forwarded=False)

    def forward():
        if st.sig is not None and not st.forwarded and st.verify is not None and st.verify.poll() is None:
            st.verify.send_signal(st.sig)
            st.forwarded = True

    def on_stop(signum, _frame):
        """A stop (TaskStop, a hard pause, a room stop): never raised into whatever --run is doing, so no child is
        SIGKILLed mid-write. Before verify, it ends the origin read and --run exits at its next checkpoint with no
        line; while verify runs, verify gets it once and the run is `stopped`; after verify ended on its own, its
        verdict stands."""
        st.sig = signum if st.sig is None else st.sig
        if st.reading is not None:
            li._kill_group(st.reading)
        forward()

    for sig in li.SIGNALS:   # kept to the end: a stop during the check or the record never kills the write
        signal.signal(sig, on_stop)

    def origin(argv):
        """One origin read, bounded by ORIGIN_TIMEOUT so a hung remote halts instead of holding the attempt for the
        harness's whole cap: (rc, stdout, why)."""
        # Its own process group, so a hung `ls-remote` under default-branch.sh is ended with it, and TERM first, so
        # a fetch gets to drop its ref lockfiles (li._kill_group: TERM, a grace, then KILL).
        p = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=li.ENV,
                             start_new_session=True)
        st.reading = p
        try:
            out_, err_ = p.communicate(timeout=ORIGIN_TIMEOUT)
        except subprocess.TimeoutExpired:
            li._kill_group(p)
            # Close, never drain: a helper outside the group (an ssh ControlMaster) may hold the pipes open.
            p.stdout.close()
            p.stderr.close()
            return 1, "", f"no answer in {ORIGIN_TIMEOUT}s"
        finally:
            st.reading = None
        return p.returncode, out_.strip(), (err_ or out_).strip()

    default = None
    if serial:
        # A serial chain never pushes: its "merged main" is its checkout's HEAD as this run starts (ADR 0055).
        sha = li.rev(root, "HEAD") if attempt == 1 else last["sha"]
        if st.sig is not None:
            return 128 + st.sig
        if not sha:
            print(f"ERROR: completion-verify: HEAD of {root} is no commit; nothing run", file=sys.stderr)
            return 1
    else:
        rc, default, why = origin(["bash", str(DEFAULT_BRANCH_SH), str(root)])
        if st.sig is not None:
            return 128 + st.sig   # a stop before verify: no line, the attempt runs again
        if rc != 0 or not default:
            print(f"ERROR: completion-verify: origin unread: {why}; nothing run", file=sys.stderr)
            return 1
        if attempt == 1:
            rc, _o, why = origin(["git", "-C", str(root), "fetch", "--quiet", "origin",
                                  f"+refs/heads/{default}:refs/remotes/origin/{default}"])   # whatever the refspec
            sha = li.rev(root, f"refs/remotes/origin/{default}") if rc == 0 else ""
            if st.sig is not None:
                return 128 + st.sig
            if not sha:
                print(f"ERROR: completion-verify: origin unread: {why or f'no origin/{default}'}; nothing run",
                      file=sys.stderr)
                return 1
        else:
            sha = last["sha"]
    if not SHA40_RE.fullmatch(sha or ""):
        print(f"ERROR: completion-verify: {sha} is no 40-hex commit name: a SHA-256 repository is not supported "
              "(verify's --detach-at is 40-hex engine-wide); nothing run", file=sys.stderr)
        return 1
    if serial:
        # The HEAD guard: the resolved sha, never the symbolic HEAD, must hold every done task's own commits here.
        held = _chain_holds(li, root, sha, path, tasks_dir)
        if st.sig is not None:
            return 128 + st.sig
        if held:
            print(f"ERROR: completion-verify: {held}; check out the branch that holds them (git -C {root} checkout "
                  "<branch>), then leg.py clear-halt; if their history was rewritten on purpose, run the suite by hand "
                  f"and remove the note's {COMPLETION_VERIFIER_KEY}:; nothing run", file=sys.stderr)
            return 1
    # Under the lock nothing else runs in this attempt: a tree left behind is a dead run's. Its worktree entry is
    # locked with that run's pid, so it is unlocked and pruned whether its directory survived or not (a locked entry
    # whose directory is gone would refuse every later `worktree add`).
    li.git(root, "worktree", "unlock", tree)
    li.git(root, "worktree", "remove", "--force", "--force", tree)
    li.git(root, "worktree", "prune")
    shutil.rmtree(tree, ignore_errors=True)
    # The canary's own words go to stderr: --run's stdout is its one JSON line.
    if st.sig is not None:
        return 128 + st.sig
    # A serial chain arms no window (ADR 0055): its Legs work in the shared checkout, and the guard above is its check.
    arm = 0 if serial else _run_canary("arm", path, tasks_dir, root, default, ro, COMPLETION_KIND, stdout=sys.stderr,
                                       own_session=True)
    if st.sig is not None:
        return 128 + st.sig   # armed, never launched: the window closes by the owner rule or the next arm
    if arm != 0:
        _completion_not_ran(state, attempt, streak, git_env="arm", canary_exit=arm)
        return 4
    # The slot wait takes what is left of the harness cap after this run's own work so far, so the suite's deadline
    # still lands inside it and a cap's TERM never stops a run that was on time.
    spent = time.monotonic() - started
    # verify runs as its own child, never in this process, so no signal state is shared (ADR 0052). It inherits the
    # attempt's lock: a --run killed outright leaves the lock held until verify ends, so no second run starts
    # beside it. `--flag=value`, so a command starting with `-` is never read as an option.
    argv = [sys.executable, str(LEAD_INTEGRATE_PY), "verify", "--outcome", "--repo", str(root), f"--detach-at={sha}",
            "--tree", tree, "--out", out, "--timeout", str(timeout), "--slots", str(slots),
            "--slot-wait", str(_slot_wait(timeout + spent)), f"--verifier={verifier}", f"--rollout={path}"]
    argv += [f"--bootstrap={bootstrap}"] if bootstrap else []
    outcome_path, log_path = Path(f"{out}{VERIFY_OUTCOME_SUFFIX}"), Path(f"{out}.log")
    # A dead run's files are never read as this run's: its outcome goes, its log is kept under a name of its own.
    outcome_path.unlink(missing_ok=True)
    if log_path.exists():
        os.replace(log_path, Path(f"{out}.dead-{_run_id(datetime.now(), os.getpid())}.log"))
    if st.sig is not None:
        return 128 + st.sig
    sys.stdout.flush()
    sys.stderr.flush()
    try:
        # Its own session, so a stop to --run's group reaches verify only through `forward`, once.
        proc = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, errors="replace", pass_fds=(lock.fileno(),), start_new_session=True)
    except OSError as e:
        said = f"verify would not start: {e}\n"
    else:
        st.verify = proc
        forward()   # a stop that landed while verify was starting
        said = proc.communicate()[0]
    said = said if not said or said.endswith("\n") else said + "\n"
    sys.stderr.write(said)
    if not log_path.exists() and said.strip():
        # verify stopped before it opened its log (a refusal): its words become the kept log the line names.
        try:
            log_path.write_text(said)
        except OSError:
            pass
    check = 0 if serial else _run_canary("check", path, tasks_dir, root, default, ro, COMPLETION_KIND,
                                         stdout=sys.stderr, own_session=True)
    note = Note(path)   # fresh: the canary may have written its log
    outcome = _read_outcome(outcome_path)
    if outcome is not None and outcome.get("sha") != sha:
        outcome = None   # not this run's tree: never read as its verdict
    result, why = _classify_completion(outcome, attempt)
    if st.forwarded:
        result, why = "stopped", (f"--run was stopped by signal {st.sig} (forwarded to verify), no verdict: the "
                                  "attempt re-runs")
    has_log = log_path.exists()
    ids = []
    if has_log and result in ("rerun", "red"):
        with open(log_path, errors="replace") as fh:
            ids = _failing_ids(fh)
    if result == "rerun" and ids:
        # The Flake log (ADR 0050): attempt 1's failing ids, so a test that flakes again can be seen in the lines.
        why += "; failing " + ", ".join(ids[:10]) + (" …" if len(ids) > 10 else "")
    if check not in (0, 3, 4, 9):
        result, why = "unrun", (f"the canary check failed (exit {check}), so its rc is never acted on, no verdict: "
                                "the attempt re-runs")
    elif check != 0:
        # 3, a trip that stands (9, a lane hold: ADR 0046), or 4, one an ack re-armed meanwhile (ADR 0053): either way
        # the rc is never acted on.
        result, why = "unrun", ("a git-env trip fell inside its window (the shared checkout changed during the run), "
                                "so its rc is never acted on, no verdict: the attempt re-runs")
    now = _now(args)
    run_id = outcome["id"] if outcome else _run_id(now, os.getpid())
    rc_word = str(outcome["rc"]) if outcome and "rc" in outcome else "absent"
    red_stem = f"{COMPLETION_RED_PREFIX}{ro}"
    followup = red_stem if result == "red" else None
    kept = Path(f"{out}.{run_id}.log")
    kept_name = str(kept) if has_log else "-"   # a line never names a log that is not there
    line = (f"- {_stamp(now)} attempt {attempt} at {sha} rc {rc_word} -> {result}: {why}"
            + (f"; fix task [[{red_stem}]]" if followup else "") + f" (run {run_id}; log {kept_name})")
    filed = None
    try:
        # The log and the fix task, then the line, the commit point: a failure before it records nothing, and the
        # attempt runs again.
        if has_log:
            os.replace(log_path, kept)
        if followup and _find_note(tasks_dir, red_stem) is None:
            _write_completion_red(tasks_dir / f"{red_stem}.md", note, ro, verifier, sha, rc_word, why, kept_name, ids,
                                  now, chain_root=root if serial else None)
            filed = tasks_dir / f"{red_stem}.md"   # only once this run wrote it: an existing one is never removed
        # The note read again right here, and saved under the note's lock (Note.save), so a Pause log line or an
        # ack written during the run is kept and a kill mid-write never truncates it.
        note = Note(path)
        note.append_line(COMPLETION_VERIFY_SECTION, line)
        note.save()
    except (OSError, ValueError) as e:
        if filed is not None:
            filed.unlink(missing_ok=True)   # a fix task for a red the record never shows would be an orphan
        print(f"ERROR: completion-verify: {e}; nothing recorded: the attempt runs again", file=sys.stderr)
        return 1
    fields = {"result": result, "rc": rc_word, "sha": sha, "attempt": attempt, "log": kept_name}
    if followup:
        fields["followup"] = followup
    _event(ro, "completion-verify", None, fields, args)
    try:
        outcome_path.unlink(missing_ok=True)
    except OSError:
        pass
    _s, _a, _l, streak = _completion_state(note)   # the note as written, so the one tail rule decides
    print(json.dumps(dict(ran=True, result=result, decided=result in COMPLETION_DECIDED, attempt=attempt,
                          streak=streak, halt=_completion_halts(result, streak), line=line[2:], followup=followup,
                          **({"canary_exit": check} if check != 0 else {}))))
    return 4 if check not in (0, 4) else 0   # an acked trip (4) needs no halt: the attempt re-runs (ADR 0053)


def cmd_completion_verify(args) -> int:
    """The completion verify (estate ADR 0009 d6, ADR 0052, ADR 0055): a rollout whose note declares
    `completion_verifier:` runs it once at its completion ceremony, on merged origin/<default> (execute § 4.5 step 5),
    or a serial chain's checkout HEAD (legs.md § Complete). Read mode prints one JSON line, and with --wait first waits
    while the attempt is in flight; --run owns one attempt end to end. The module docstring holds the rules."""
    if args.wait is not None and args.run:
        print("ERROR: completion-verify: --wait is read mode's, never with --run; nothing run", file=sys.stderr)
        return 2
    path = Path(os.path.expanduser(args.rollout))
    if not path.is_file():
        print(f"ERROR: completion-verify: rollout note not found at {path}", file=sys.stderr)
        return 1
    deadline = None if args.wait is None else time.monotonic() + args.wait
    settled = None   # the (state, attempt) a note read after a free probe of that attempt's lock last gave
    while True:
        try:
            note = Note(path)
            verifier, _bootstrap, _timeout = _completion_config(note)
        except ValueError as e:
            print(f"ERROR: completion-verify: {e}", file=sys.stderr)
            return 2 if isinstance(e, CompletionValueError) else 1
        ro = path.stem
        if not verifier:
            if args.run:
                print(f"ERROR: completion-verify: {ro} declares no {COMPLETION_VERIFIER_KEY}:; nothing run",
                      file=sys.stderr)
                return 2
            print(json.dumps({"verifier": None, "state": "absent"}))
            return 0
        serial = _shape(note) == SHAPES[1]
        if serial:
            root, why = _serial_root(note)
            if root is None:
                print(f"ERROR: completion-verify: {why}", file=sys.stderr)
                return 1
        else:
            root = _project_root(note)
            if root is None:
                print(f"ERROR: completion-verify: {ro} has no `Project root:` line", file=sys.stderr)
                return 1
        tasks_dir = Path(os.path.expanduser(args.tasks_dir))
        if args.run:
            return _completion_run(args, path, ro, root, tasks_dir, serial)
        state, attempt, last, streak = _completion_state(note)
        tree, out = _completion_paths(root, ro, attempt, serial)
        if state not in COMPLETION_DECIDED:
            if _attempt_running(_attempt_lock(root, ro, attempt)):
                state, settled = "in-flight", None   # a run holds it: its line may yet land, so no read is settled
            elif settled != (state, attempt):
                # A --run records its line under the attempt's lock and frees it only as it exits, so a note read
                # before a free probe may predate the line of a run that ended in between: read it once more.
                settled = (state, attempt)
                continue
        remaining = None if deadline is None else deadline - time.monotonic()
        if state == "in-flight" and remaining is not None and remaining > 0:
            # --wait (ADR 0055): a serial Leg has no heartbeat, so this bounded, read-only wait is the notification
            # of a --run no task of its own will end (one killed outright leaves its verify holding the lock). The
            # note and the lock are read afresh each pass; nothing is written, armed or recorded.
            time.sleep(min(COMPLETION_WAIT_POLL, remaining))
            continue
        found = _find_note(tasks_dir, f"{COMPLETION_RED_PREFIX}{ro}") if state == "red" else None
        followup = found.stem if found else None
        print(json.dumps({"verifier": verifier, "state": state, "attempt": attempt,
                          "sha": last["sha"] if last else None, "repo": str(root), "tree": tree, "out": out,
                          "streak": streak, "followup": followup,
                          "summary": _completion_summary(state, last, verifier, followup)}))
        return 0


def _wait_seconds(v):
    """--wait's value: an integer from 1 to COMPLETION_WAIT_S (argparse exits 2 on anything else)."""
    try:
        n = int(v)
    except ValueError:
        n = 0
    if not 1 <= n <= COMPLETION_WAIT_S:
        raise argparse.ArgumentTypeError(f"--wait takes whole seconds from 1 to {COMPLETION_WAIT_S}, not {v!r}")
    return n


# ---- CLI --------------------------------------------------------------------

# ---- moving: the Watchdog's reading (ADR 0048, p29-7; the module docstring's "moving") ---------------------------

STALL_AFTER_MIN = int(LEASE_LAPSE / timedelta(minutes=1))   # 45: a lead's lease lapse (p28-4), two missed ticks and slack
STALL_AFTER_MAX = 1440
REGENERATE_STALL_MIN = 120    # the Approved-queue route's one foreground turn: one harness step, never its bound
# The meant waits that silence ends: only the lead's own tick releases them (status § The Watchdog's reading, *Which
# waits silence judges*, binds this list by a contract test). moving_verdict returns each through its by_silence, which
# refuses a cause not listed here, so the code cannot judge a wait by silence that the list (and status) leaves out.
SILENCE_JUDGED = ("merge-hold", "regenerating")
# Execute § 7's *Whole-rollout halts kept (ADR 0048)*, judged from the open halt H's reason (re.match): a halt that
# holds the whole rollout on purpose, so work beside it waits on Lachy, never a stall. {rollout} is the rollout's stem,
# escaped. A contract test binds this list to § 7's, both ways.
WHOLE_HALT_PATTERNS = (
    r"engine snapshot cut failed",
    r"engine snapshot unusable",
    r"engine snapshot resolve failed",
    r"\S+ is on the landing register",
    r"landing-register check failed",
    r"repoPath is a live plugin marketplace checkout",
    r"self-rollout check failed",
    r"local default branch is ahead of origin",
    r"pushed-base check failed",
    r"launched outside the Project root",
    r"launch-directory check failed",
    r"git env set in the lead session",
    r"git-env check failed",
    r"git-env canary failed",
    r"next refused the rollout",
    r"invalid verify_timeout on \[\[[^\]]+\]\]",
    r"completion verify: rollout note unreadable",
    r"rollout settings refused",
    r"verify-slot\.py not found",
    r"invalid round budget: \S+ on \[\[{rollout}\]\]",
    r"lane hold not written on \[\[[^\]]+\]\]",
    r"args\.verifySlot is not this entry's verify-timeout verifySlot",
    r"engine refused the args of \[\[[^\]]+\]\]",
    r"ladder file refused",
    r"lead-integrate\.py failed on \[\[[^\]]+\]\]",
    r"merge-task\.sh exited \S+ on the revert of \[\[[^\]]+\]\]",
    r"origin unreachable while reverting \[\[[^\]]+\]\]",
    r"completion verify: no verdict in three runs",
    r"completion verify failed",
    r"paused at user request",
    r"hold_until needs you on \[\[{rollout}\]\]",
    r"approved queue: regenerate stopped:",
    r"approved queue: \[\[[^\]]+\]\] written unstamped:",
    r"surface held: \[\[[^\]]+\]\] writes \S+",
    r"surface re-check failed",
)
# The two kept halts `moving` reads live from `next` (step 7), never from H: a bare checkout's git-env trip and a RACE
# revert that did not land. Step 7 builds its two reasons from these prefixes (a contract test binds them to § 7's).
LIVE_WHOLE_REASONS = ("git-env trip:", "RACE: the revert of")
LIVE_GIT_ENV, LIVE_MAIN_RED = LIVE_WHOLE_REASONS


class MovingError(Exception):
    """A lost look (`moving` exit 1): the note, the Run record or `next` could not be read. Never a stall."""


def _whole_halt_res(stem):
    """WHOLE_HALT_PATTERNS compiled for one rollout (its stem formatted in where a pattern names the rollout)."""
    return [re.compile(pat.replace("{rollout}", re.escape(stem))) for pat in WHOLE_HALT_PATTERNS]


def _next_dry_run(rollout_path, tasks_dir, now, gh_bin):
    """`next --dry-run` in-process through _parser() (no --running: every in_progress note is live, as status reads it):
    (rc, its JSON or None, its stderr). Under --dry-run it writes no note and no event, takes no claim lock and writes
    no claims file, and runs no _record_sleeps, idle-slots or night record. An exception is a MovingError."""
    ns = _parser().parse_args(["next", "--rollout", str(rollout_path), "--tasks-dir", str(tasks_dir), "--dry-run",
                               "--now", now.isoformat(), "--gh-bin", gh_bin])
    out, err = io.StringIO(), io.StringIO()
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = cmd_next(ns)
    except Exception as e:  # noqa: BLE001 — a `next` that raises is a lost look, never a verdict
        raise MovingError(f"next raised {type(e).__name__}: {e}")
    if rc != 0:
        return rc, None, err.getvalue()
    try:
        return 0, json.loads(out.getvalue()), err.getvalue()
    except ValueError as e:
        raise MovingError(f"next printed no JSON: {e}")


def _next_idle_reason(nx):
    """`next`'s verdict worded as execute § 7 words it, for a reading with no work and no open halt (step 12c)."""
    halt = nx.get("halt")
    lane = nx.get("laneHold") or []
    if halt == "stuck":
        unv = next((h["slug"] for h in nx.get("raceHold") or [] if h.get("kind") == UNVERIFIED_MARK.rstrip(":")), None)
        if unv:
            return f"UNVERIFIED undecided: [[{unv}]]"
        return f"nothing can start: {len(nx.get('setAside') or [])} set aside"
    if halt == "awaiting-sign-off":
        first = (nx.get("awaitingSignOff") or [{}])[0].get("slug")
        return f"awaiting sign-off: [[{first}]]" if first else "awaiting sign-off"
    if halt == "race":
        first = next((e["slug"] for e in lane if e.get("hold") == "race" and not e.get("revert")), None)
        return f"RACE undecided: [[{first}]]" if first else "RACE undecided"
    if halt == "lane":
        e = next((e for e in lane if e.get("hold") == "lane"), None)
        return f"lane held: {e['cause']} on [[{e['slug']}]]" if e else "lane held"
    if halt == "git-env":
        return f"{LIVE_GIT_ENV} the shared checkout changed"
    if halt == "held":
        h = next((h for h in nx.get("holdUntil") or [] if h.get("held") and h.get("waits") == "you"), None) or \
            next((h for h in nx.get("holdUntil") or [] if h.get("held")), None)
        if h:
            tail = f"{h.get('pr')} closed unmerged" if h.get("state") == "CLOSED" else "unreadable"
            return f"hold_until needs you on [[{h.get('note')}]]: {tail}"
        return "hold_until needs you"
    if halt == "empty":
        return "the rollout links no task"
    if halt == "paused":
        return "paused at user request"
    return f"nothing moves (next's halt: {halt})"


def moving_verdict(rollout_path, tasks_dir, now=None, stall_after=STALL_AFTER_MIN, gh_bin="gh") -> dict:
    """The Watchdog's reading of one rollout (the module docstring's "moving", the algorithm's one copy): {rollout,
    verdict, cause, reason, lastEvent, ageMinutes, stallAfter, until, work}, verdict moving | stalled | waiting | skip.
    Read-only: it writes no note, no event and no lock or claims file, and no bytecode. Raises MovingError when the
    note, the Run record or `next` cannot be read."""
    sys.dont_write_bytecode = True
    rollout_path = Path(os.path.expanduser(str(rollout_path)))
    tasks_dir = Path(os.path.expanduser(str(tasks_dir)))
    now = now or datetime.now().astimezone()
    ro = rollout_path.stem
    work = {"running": [], "lane": False, "start": [], "halt": None, "reentry": [], "coolDown": [], "capHeld": []}
    out = {"rollout": ro, "verdict": None, "cause": None, "reason": "", "lastEvent": None, "ageMinutes": None,
           "stallAfter": stall_after, "until": None, "work": work}

    def done(verdict, cause, reason, until=None):
        out.update(verdict=verdict, cause=cause, reason=reason, until=until)
        return out

    if not rollout_path.is_file():
        raise MovingError(f"rollout note not found at {rollout_path}")
    try:
        note = Note(rollout_path)
    except (OSError, ValueError) as e:
        raise MovingError(f"cannot read {rollout_path}: {e}")
    # 1. skip: serial, superseded, done or dropped; or archived (not directly in the tasks dir).
    why = _ledger_skip(note)
    if why:
        return done("skip", why, f"{ro}: {why}")
    if os.path.realpath(rollout_path.parent) != os.path.realpath(tasks_dir):
        return done("skip", "archived", f"{ro}: not directly in {tasks_dir}")
    # 2. the Run record.
    lines, state = _record_read(ro), _record_state(ro)
    if lines is None or state is None:
        raise MovingError(f"the Run record of {ro} cannot be read")
    # 9 (read first, reported on every verdict). L, the last life sign; S, the silence since the latest of L, the
    # wake and the boot (machine_times with since=now never reads pmset).
    st = _stop_state(lines)
    last_live = st["live"][-1] if st["live"] else None
    mt = machine_times(since=now, now=now)
    boot = mt.get("boot")
    wake = mt.get("wake") if mt.get("wake") is not None and mt.get("wake") <= now else None
    bases = [t for t in (last_live, wake, boot) if t is not None]
    base = max(bases) if bases else None
    silence = (now - base).total_seconds() / 60 if base is not None else None
    if last_live is not None:
        out["lastEvent"] = _zms(last_live)
        out["ageMinutes"] = max(0, int((now - last_live).total_seconds() // 60))
    spans = stop_spans(lines)

    def silent(bound):
        """The silence test at `bound` minutes: a stalled reading, or None while the lead's life signs hold."""
        if last_live is None:
            return done("stalled", "silent", "no life sign in the Run record")
        if silence is not None and silence > bound:
            if boot is not None and boot > last_live:
                cause = "mac-restart"
            elif any(sp["cause"] == "usage-limit" and sp["end"] is None for sp in spans):
                cause = "usage-limit"
            else:
                cause = "silent"
            return done("stalled", cause, f"no life sign for {out['ageMinutes']}m")
        return None

    def by_silence(bound, cause, reason, until=None):
        """A meant wait only the lead's own tick ends: the silence test at `bound`, else waiting `cause`. The cause must
        be in SILENCE_JUDGED (the list status's *Which waits silence judges* is bound to); one that is not is a defect
        in this function, never a reading."""
        if cause not in SILENCE_JUDGED:
            raise AssertionError(f"moving: {cause!r} is judged by silence but is not in SILENCE_JUDGED")
        return silent(bound) or done("waiting", cause, reason, until)

    # 3. Pauses: a sign-off pause first (await-sign-off stamps paused: with it), then a stamped pause (his act).
    if _scalar(note.get(PAUSED_FOR_KEY)).lower() == SIGN_OFF:
        return done("waiting", "sign-off", f"paused for sign-off since {_scalar(note.get('paused')) or '?'}")
    if _pause_stands(note, lines)[0]:
        return done("waiting", "paused", "paused at user request")
    # 4. A room stop under its bound.
    if _room_stop_stands(note, now):
        room = _last_room_stop(note)
        until = _parse_ts(room[0]) + ROOM_STOP_BOUND
        return done("waiting", "room-stop", f"room stop since {room[0]}", _stamp(until))
    # 5. Never started.
    linked, _index = _scan(rollout_path, tasks_dir)
    if never_started(note, linked)[0] and not any(d.get("kind") == "lead-entry" for d in lines):
        return done("waiting", "not-started", "the rollout has not started")
    # 6. `next`, in-process and dry.
    rc, nx, err = _next_dry_run(rollout_path, tasks_dir, now, gh_bin)
    if rc != 0:
        line = next((l for l in err.splitlines() if l.startswith("ERROR")), err.strip().splitlines()[-1] if err.strip()
                    else f"exit {rc}")
        return done("waiting", "you", f"next refused the rollout: {line}")
    if nx.get("halt") in ("superseded", "done"):
        return done("skip", nx["halt"], f"{ro}: next reports halt {nx['halt']}")
    work["halt"] = nx.get("halt")
    # 7. The whole holds `next` reads live, their reasons built from LIVE_WHOLE_REASONS.
    if any(t.get("scope") == "rollout" for t in nx.get("gitEnvHold") or []):
        return done("waiting", "you", f"{LIVE_GIT_ENV} the shared checkout changed")
    if nx.get("mainRed"):
        first = nx["mainRed"][0]
        return done("waiting", "you", f"{LIVE_MAIN_RED} [[{first['slug']}]] did not land: {first.get('why', '')}")
    # 8. W, the work the lead could act on now.
    lane_hold = nx.get("laneHold") or []
    merge_open = {t for h, t in state["holds"] if h == "merge" and t}
    merge_held = [x for x in (nx.get("integrating") or []) + [h["slug"] for h in nx.get("raceHold") or []]
                  if x.lower() in merge_open]
    blocked = any(e.get("hold") in ("git-env", "lane") for e in lane_hold)
    # The lead's own RACE re-verify (or its landing tail) holds the lane on the undecided RACE's task: the Run record's
    # lane is still open on it (execute § 4.5's RACE procedure keeps it held; the third `noslot` frees it, and the RACE
    # then waits for Lachy). It is work, judged by silence: a re-verify in flight never halts on its own task.
    rec_lane = (state.get("lane") or "").lower()
    race_lane = bool(rec_lane) and any(e.get("hold") == "race" and not e.get("revert") and e["slug"].lower() == rec_lane
                                       for e in lane_hold)
    work["lane"] = ((not lane_hold and bool(nx.get("integrating") or nx.get("awaitingIntegration"))
                     and not merge_held)
                    or (not blocked and any(e.get("hold") == "race" and e.get("revert") for e in lane_hold))
                    or race_lane)
    work["running"] = list(nx.get("running") or [])
    work["start"] = list(nx.get("start") or []) + list(nx.get("restart") or [])
    race_slugs = {h["slug"].lower() for h in nx.get("raceHold") or []}
    ro_held = any(h.get("scope") == "rollout" and h.get("held") for h in nx.get("holdUntil") or [])
    if not ro_held and not nx.get("pauseRequested"):
        root = _project_root(note)
        repo = str(root) if root is not None and root.is_dir() else None
        heat_mod = _heat_module()
        hot = bool(heat_mod) and (nx.get("heat") or {}).get("level", 0) >= heat_mod.HEAT_HOLD
        revises = 0
        for e in nx.get("setAside") or []:
            if e.get("setAsideAt") not in ("run", "integration") or e["slug"].lower() in race_slugs or e.get("holdUntil"):
                continue
            path = tasks_dir / f"{e['slug']}.md"
            try:
                tnote = Note(path)
            except (OSError, ValueError):
                continue
            try:
                budget = _retry_budget(tnote, note)
                k = budget["maxReviewRounds"]["value"] if budget["maxReviewRounds"] and not budget["error"] else None
                inp = _lead().task_inputs(path, tnote, max_rounds=k, repo=repo)
                v = _lead().auto_retry_verdict(path, tnote, inp, note, now)
            except Exception as ex:  # noqa: BLE001 — a lost look, never a verdict
                raise MovingError(f"inputs on [[{e['slug']}]] raised {type(ex).__name__}: {ex}")
            if v.get("humanFix") is not None:
                continue
            after = _parse_ts(v["autoRetryAfter"]) if v.get("autoRetryAfter") else None
            if after is not None and after > now:
                work["coolDown"].append({"slug": e["slug"], "class": v.get("autoRetryClass"), "until": v["autoRetryAfter"]})
            elif inp.get("autoRevise"):
                if nx.get("slotsInUse", 0) + revises < nx.get("slotLimit", 0):
                    work["reentry"].append(e["slug"])
                else:
                    cause = "heat" if hot else "away-cap" if (nx.get("trickle") or {}).get("away") else "trickle"
                    work["capHeld"].append({"slug": e["slug"], "cause": cause})
                revises += 1
            else:
                work["reentry"].append(e["slug"])
    has_work = bool(work["running"] or work["lane"] or work["start"] or work["reentry"]
                    or work["halt"] in ("complete", "regenerate"))
    # 10. The open halt H: the last open `halt` stop, its reason read off its own `stopped` line.
    h = next((sp for sp in reversed(spans) if sp["cause"] == "halt" and sp["end"] is None), None)
    # 11. With work.
    if has_work:
        if h is not None and any(r.match(h["reason"]) for r in _whole_halt_res(ro)):
            return done("waiting", "you", h["reason"])
        if h is not None:
            return done("stalled", "halt", f"{h['reason'] or 'halted'}: the halt holds more than it threatens")
        if work["halt"] == "regenerate":
            # The Approved-queue route runs as one foreground turn with no life sign: its own bound, in place of
            # stall-after, whatever else is in W.
            until = _stamp(base + timedelta(minutes=REGENERATE_STALL_MIN)) if base is not None else None
            return by_silence(REGENERATE_STALL_MIN, "regenerating", "approved queue: regenerating", until)
        return silent(stall_after) or done("moving", None, "work moves")
    # 12a. A wait only the lead's own tick ends: a merge hold, judged by silence.
    if merge_held:
        return by_silence(stall_after, "merge-hold", f"merge hold on [[{merge_held[0]}]]")
    # 12b. Waits judged by their own condition, in step 1.6's order.
    if work["coolDown"]:
        first = min(work["coolDown"], key=lambda c: _parse_ts(c["until"]))
        return done("waiting", "cool-down", f"{first['class']} cool-down: [[{first['slug']}]] retries at {first['until']}",
                    first["until"])
    holds = [x["reason"] for x in nx.get("hold") or []]
    for cause, prefix in (("heat", HEAT_PREFIX), ("away-cap", AWAY_CAP_PREFIX), ("trickle", TRICKLE_PREFIX)):
        why_ = next((x for x in holds if x.startswith(prefix)), None)
        held_ = next((c for c in work["capHeld"] if c["cause"] == cause), None)
        if why_ or held_:
            tr = nx.get("trickle") or {}
            if why_ is None:
                why_ = (f"{HEAT_PREFIX} the Mac is hot ({(nx.get('heat') or {}).get('name')})" if cause == "heat" else
                        f"{AWAY_CAP_PREFIX} {tr.get('running')}/{tr.get('awayCap')} tasks running on this Mac"
                        if cause == "away-cap" else
                        f"{TRICKLE_PREFIX} {tr.get('running')}/{tr.get('limit')} tasks running on this Mac")
            return done("waiting", cause, why_)
    why_ = next((x for x in holds if x.startswith(LAST_START_PREFIX)), None)
    if why_:
        return done("waiting", "last-start", why_, (nx.get("lastStarts") or {}).get("morning"))
    om = nx.get("onMerge")
    if om and om.get("action") == "waits":
        return done("waiting", "approved-queue", f"approved queue waits: {om.get('why')}")
    pr_hold = next((x for x in nx.get("holdUntil") or [] if x.get("held") and x.get("waits") == "merge"), None)
    if pr_hold:
        return done("waiting", "pr-hold", f"held until {pr_hold.get('pr')} merges")
    if work["halt"] == "paused":
        return done("waiting", "paused", "paused at user request")
    # 12c. Lachy's: the open halt's reason, else `next`'s verdict as § 7 words it.
    return done("waiting", "you", h["reason"] if h is not None and h["reason"] else _next_idle_reason(nx))


def cmd_moving(args) -> int:
    """`moving` (the module docstring's "moving"): one compact JSON line, exit 0 for any verdict; 1 a lost look; 2
    usage."""
    sys.dont_write_bytecode = True
    if not 1 <= args.stall_after <= STALL_AFTER_MAX:
        print(f"ERROR: moving: usage: --stall-after must be an integer from 1 to {STALL_AFTER_MAX}, got "
              f"{args.stall_after}", file=sys.stderr)
        return 2
    try:
        out = moving_verdict(args.rollout, args.tasks_dir, _now(args), args.stall_after, args.gh_bin)
    except MovingError as e:
        print(f"ERROR: moving: {e} (a lost look, never a stall)", file=sys.stderr)
        return 1
    print(json.dumps(out, separators=(",", ":")))
    return 0


def _parser():
    """The CLI's argparse parser (p29-7: moved out of main() unchanged, so `moving` builds `next`'s Namespace through
    it and every default `next` gains reaches that dry run too)."""
    p = argparse.ArgumentParser(description="Deterministic vault reconcile for a rollout's queue (ADR 0030).")
    sub = p.add_subparsers(dest="cmd", required=True)
    tasks_dir_help = "task-note dir (default: the vault's Work/Tasks)"
    now_help = "the time to stamp or measure against, ISO (default: now)"

    r = sub.add_parser("reconcile", help="write task frontmatter + feedback runs from a workflow result")
    r.add_argument("--result", default="-", help="path to the workflow result JSON, or '-' for stdin (default)")
    r.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    r.add_argument("--now", type=_iso_arg, default=None, help=now_help + " (the run headings' stamp)")
    r.add_argument("--dry-run", action="store_true")
    r.add_argument("--no-verdict", action="store_true",
                   help="ADR 0053: the integrate call's canary check exited 4: an integrated row's line reads void")
    r.set_defaults(func=cmd_reconcile)

    nx = sub.add_parser("next", help="print the queue's next moves as JSON (start/restart/hold/halt)")
    nx.add_argument("--rollout", required=True, help="path to the rollout note")
    nx.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    nx.add_argument("--running", default=None,
                    help="comma-separated slugs whose task calls are live (default: every in_progress note); "
                         "any other in_progress note is stalled and restarts")
    nx.add_argument("--now", type=_iso_arg, default=None, help=now_help)
    nx.add_argument("--gh-bin", default="gh", help="the gh executable a hold_until's PR is read through (tests pass a stub)")
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

    ren = sub.add_parser("record-entry", help="the lead's loop entry in the Run record: the stops it finds, then one "
                                              "lead-entry (p29-10, ADR 0051; execute § 4.5 *Run record*)")
    ren.add_argument("--rollout", required=True, help="path to the rollout note")
    ren.add_argument("--by", required=True, choices=ENTRY_BYS, help="what opened this entry")
    ren.add_argument("--cause", choices=ENTRY_CAUSES, default=None,
                     help="why the session stopped, when the Prompt that opened the entry names it")
    ren.add_argument("--session", default=None, help="the lead's session id (default: CLAUDE_CODE_SESSION_ID)")
    ren.add_argument("--now", type=_iso_arg, default=None, help=now_help)
    ren.add_argument("--dry-run", action="store_true", help="print what it would record; write nothing")
    ren.set_defaults(func=cmd_record_entry)

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

    aq = sub.add_parser("approve-queue", help="approve a queue on Lachy's words (p30-4; vault-grammar § Approved queue): "
                                              "write hold_until, on_merge: regenerate and start: unattended, print "
                                              "one undo line; exit 1 refused, nothing written")
    aq.add_argument("--rollout", required=True, help="path to the rollout note he approved")
    aq.add_argument("--pr", required=True, help="the gating PR: owner/repo#N or its URL")
    aq.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    aq.set_defaults(func=cmd_approve_queue)

    ss = sub.add_parser("stamp-start", help="under an approved queue's chain (schedule step 8): stamp start: unattended "
                                            "on the note its regenerate wrote, print one undo line; exit 1 refused")
    ss.add_argument("--rollout", required=True, help="path to the new rollout note (it supersedes the approved queue)")
    ss.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    ss.set_defaults(func=cmd_stamp_start)

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

    rvf = sub.add_parser("record-verify", help="record the lead's Integration verify or RACE re-verify from its "
                                                "<out>.flake.json: each Flake logged and filed, a timeout logged as "
                                                "load (ADR 0050, 0051); run only after its canary check exited 0")
    rvf.add_argument("--rollout", required=True, help="path to the rollout note")
    rvf.add_argument("--tasks", required=True, help="the verified task's slug")
    rvf.add_argument("--site", required=True, choices=RECORD_VERIFY_SITES, help="integration (step 3) or race (the RACE "
                                                                                 "procedure)")
    rvf.add_argument("--from", dest="from_", required=True, help="lead-integrate.py verify --diff-base's <out>.flake.json")
    rvf.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help + " (the follow-ups' home)")
    rvf.add_argument("--now", type=_iso_arg, default=None, help=now_help + " (the Flake log line's stamp)")
    rvf.add_argument("--dry-run", action="store_true", help="print what would be recorded; write nothing")
    rvf.set_defaults(func=cmd_record_verify)

    cv = sub.add_parser("completion-verify", help="the completion verify (estate ADR 0009 d6, ADR 0052): print the "
                                                  "attempt's state as JSON (read-only), or with --run run one attempt "
                                                  "end to end (arm, verify, check, record) under its lock")
    cv.add_argument("--rollout", required=True, help="path to the rollout note")
    cv.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help + " (the fix task's home)")
    cv.add_argument("--run", action="store_true", help="run the current attempt: the canary arm, lead-integrate.py "
                                                       "verify --outcome, the check and the record")
    cv.add_argument("--wait", nargs="?", const=COMPLETION_WAIT_S, type=_wait_seconds, default=None, metavar="SECONDS",
                    help="read mode: wait while the attempt is in flight, up to SECONDS (default "
                         f"{COMPLETION_WAIT_S}), then print the read; a serial Leg's, which has no heartbeat (ADR 0055)")
    cv.add_argument("--now", type=_iso_arg, default=None, help=now_help + " (the log line's stamp)")
    cv.set_defaults(func=cmd_completion_verify)

    ag = sub.add_parser("approve-gates", help="record a sign-off for a gate-pending task's gated inputs: Lachy's explicit "
                                              "one, or with --standing the standing approval's (ADR 0008, ADR 0034)")
    ag.add_argument("--tasks", required=True, help="comma-separated task slugs (must be at status gate-pending)")
    ag.add_argument("--standing", action="store_true",
                    help="sign only the spend gates the standing approval covers (spend_approval_usd: task, rollout, "
                         "rollouts.toml, built-in 0 = off), and while this calendar month's standing-approved spend "
                         "(every rollout note's ## Needs-you log) stays within the same limit; each signing is logged "
                         "there; and the credential gates the repo's declared test-credential class covers "
                         "(rollouts.toml test_credentials, each key proved present in its file; ADR 0062); the rest "
                         "stay pending as ASK lines: exit 0 all signed, 3 some left, 1 an error (ADR 0034)")
    ag.add_argument("--rollout", default=None,
                    help="with --standing (required there): the rollout note, whose frontmatter and Project root "
                         "resolve spend_approval_usd; the task's rollout: must name it. Without --standing only the "
                         "Engine snapshot guard reads it (orient-all's Sign-off passes it)")
    ag.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    ag.add_argument("--date", default=None, help="sign-off date stamped on each gate (default: today)")
    ag.add_argument("--now", type=_iso_arg, default=None,
                    help=now_help + " (the ready: restamp of a stop at Integration; with --standing also the Needs-you "
                                    "log line's stamp and the calendar month the month line sums)")
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

    lh = sub.add_parser("lane-hold", help="hold the Integration lane for a cause that reaches every merge (ADR 0048; "
                                          "execute § 4.5 *Lane hold*): one ## Lane log line, the evidence on stdin, "
                                          "then the lane freed; exit 1 refused, nothing written")
    lh.add_argument("--rollout", required=True, help="path to the rollout note")
    lh.add_argument("--tasks", required=True, help="the one task slug that held the lane")
    lh.add_argument("--cause", required=True, help="one of " + ", ".join(LANE_HOLD_CAUSES))
    lh.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    lh.add_argument("--now", type=_iso_arg, default=None, help=now_help + " (the line's stamp)")
    lh.add_argument("--dry-run", action="store_true")
    lh.set_defaults(func=cmd_lane_hold)

    la = sub.add_parser("lane-ack", help="record Lachy's ack of a Lane hold (repair § 3g, its one writer): one ## Lane "
                                         "log line; exit 1 refused, nothing written")
    la.add_argument("--rollout", required=True, help="path to the rollout note")
    la.add_argument("--tasks", required=True, help="comma-separated slugs the hold lines name")
    la.add_argument("--fix", required=True, help="Lachy's words: what he fixed or decided (one line)")
    la.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help + " (the guard's only read)")
    la.add_argument("--now", type=_iso_arg, default=None, help=now_help + " (the line's stamp)")
    la.add_argument("--dry-run", action="store_true")
    la.set_defaults(func=cmd_lane_ack)

    mv = sub.add_parser("moving", help="the Watchdog's reading (ADR 0048; status § The Watchdog's reading): one JSON "
                                       "line, moving | stalled | waiting | skip; read-only, guard-exempt")
    mv.add_argument("--rollout", required=True, help="path to the rollout note")
    mv.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help=tasks_dir_help)
    mv.add_argument("--now", type=_iso_arg, default=None, help=now_help)
    mv.add_argument("--stall-after", type=int, default=STALL_AFTER_MIN,
                    help=f"minutes of silence before work reads stalled, 1 to {STALL_AFTER_MAX} (default {STALL_AFTER_MIN})")
    mv.add_argument("--gh-bin", default="gh", help="the gh executable `next`'s dry run reads PR holds through")
    mv.set_defaults(func=cmd_moving)
    return p


def main() -> int:
    args = _parser().parse_args()
    refusal = _engine_guard(args)
    if refusal:
        print(refusal, file=sys.stderr)
        return 2
    return args.func(args)


# engine-snapshot.py, this tree's own copy (ADR 0043): loaded only for the guard, as _ladder() loads ladder.py.
ENGINE_SNAPSHOT_PY = Path(__file__).resolve().parent.parent.parent / "_shared" / "scripts" / "engine-snapshot.py"
GUARD_SCRIPT = "skills/execute/scripts/reconcile-rollout.py"
# The three verbs any root runs (the module docstring's Engine snapshot guard says why): status and moving write
# nothing (moving is the Watchdog's reading, which must read any rollout from any root), and fold-journals never reads
# the note and writes only the Run record, a cross-version store.
GUARD_EXEMPT = ("status", "fold-journals", "moving")


def _guarded_notes(args):
    """(rollout notes, task notes) the guard asks about for this call: the note --rollout (carry: --from) names; each
    --tasks slug's note; and, for reconcile, each result row's task note. reconcile's result is read here, once, and
    kept on args._result_raw for cmd_reconcile (stdin cannot be read twice); a result that cannot be read or parsed
    adds no row, and cmd_reconcile then fails on it as before."""
    rollout = getattr(args, "from_", None) if args.cmd == "carry" else getattr(args, "rollout", None)
    rollouts = [rollout] if rollout else []
    tasks_dir = Path(os.path.expanduser(getattr(args, "tasks_dir", None) or str(DEFAULT_TASKS_DIR)))
    raw_tasks = getattr(args, "tasks", None)
    slugs = [s.strip() for s in raw_tasks.split(",") if s.strip()] if isinstance(raw_tasks, str) else []
    tasks = [tasks_dir / f"{slug}.md" for slug in slugs]
    if args.cmd == "reconcile":
        try:
            args._result_raw = (sys.stdin.read() if args.result == "-"
                                else Path(os.path.expanduser(args.result)).read_text())
        except (OSError, ValueError):
            return rollouts, tasks
        try:
            rows = json.loads(args._result_raw).get("tasks") or []
            tasks += [resolve_task_path(t, tasks_dir) for t in rows
                      if isinstance(t, dict) and (t.get("taskPath") or t.get("slug"))]
        except Exception:  # noqa: BLE001 — an unreadable result guards nothing; cmd_reconcile reports it
            pass
    return rollouts, tasks


def _engine_guard(args):
    """The guard's refusal line for this call (the module docstring's Engine snapshot guard), else None: guard() on
    its rollout note, then guard_task() on each task note _guarded_notes names (the rollout its `rollout:` names), so
    a task-keyed verb run without --rollout is guarded too."""
    if args.cmd in GUARD_EXEMPT:
        return None
    rollouts, tasks = _guarded_notes(args)
    if not rollouts and not tasks:
        return None
    try:
        sys.dont_write_bytecode = True
        spec = importlib.util.spec_from_file_location("thread_engine_snapshot", ENGINE_SNAPSHOT_PY)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    except Exception:  # an engine-snapshot.py that will not load guards nothing (only positive evidence refuses)
        return None
    root = ENGINE_SNAPSHOT_PY.parent.parent.parent.parent
    for note in rollouts:
        line = mod.guard(note, root, GUARD_SCRIPT)
        if line:
            return line
    for task in tasks:
        line = mod.guard_task(task, root, GUARD_SCRIPT)
        if line:
            return line
    return None


if __name__ == "__main__":
    sys.exit(main())
