#!/usr/bin/env python3
"""The Run record's one writer (ADR 0032; p15-1). This docstring is the schema's only copy.

python >= 3.8, stdlib only: hooks may run it under /usr/bin/python3, so no 3.10+ syntax. Called as:

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/run_record.py emit --kind <kind> \\
        [--rollout <slug>] [--task <slug>] [--json <object>|-] [--ts <stamp>]  || true
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/run_record.py dir

or imported by path (importlib.util.spec_from_file_location, git-env-canary.py's _load_reconcile pattern):

    emit(rollout, kind, task=None, fields=None, *, ts=None, env=None, strict=False) -> bool
    check(rollout, kind, task=None, fields=None, *, ts=None) -> None   (raises Refused exactly where emit would
                                           refuse, and writes nothing: reflect.py checks a whole pass first)
    events_dir(env=None) -> str            record_path(rollout, env=None) -> str
    normalise_slug(value) -> str           Refused, KINDS, TERMINAL_STATUSES, REVIEWS, TUNINGS, REFLECTIONS, GRADE_LOG,
                                           RESERVED
    verdict_digest(verdict, feedback) -> str    verdict_key(line) -> tuple   (review-verdict's identity, p21-3:
                                           the writer, reconcile-rollout.py, and the reader, score.py, share them)
    watch_id(rule, shape) -> str           knob_key(repo, key, rule, direction) -> str   (the weekly reading's
                                           identities, p21-7: reflect.py writes them, tune.py reads them back)
    cadence(lines) -> (days, streak)       (the cadence rule, p21-8: reflect.py's close writes it, reflect-due.py
                                           reads it)
    line_bytes(kind, fields, rollout=None, task=None) -> int   (the bytes emit would write for these fields now, on
                                           this host, its newline included, MAX_LINE or not, no field checked: a writer
                                           keeps a long line under MAX_LINE in its own words; p29-11, ledger.py's audit)

Callers: in-process callers use the default strict=False, which never raises; shell callers append
`|| true`. Recording must never break a rollout.

Directory: ${THREAD_EVENTS_DIR:-${XDG_STATE_HOME:-~/.local/state}/thread/events}. An empty value counts
as unset; `~` expands in the override. A relative override is a warned write failure (nothing written); a
relative XDG_STATE_HOME is ignored, as the XDG spec says. A dangling symlink is a warned failure, never a
fall back to another directory. Every writer resolves this chain itself: hooks, Codex and launchd export no
override, so the default path is the shared meeting point. On Lachy's machine ~/.local/state/thread/events is
a symlink to _shared/state/thread-events/ (in place since 2026-10-06), so the record is backed up; nothing
here creates the link, and on a machine without it the first emit's os.makedirs creates a real directory
there. THREAD_EVENTS_DIR is for tests and non-default setups. `dir` prints the resolved directory, so any writer can confirm it lands in
the same place.

Files: <rollout>.jsonl, one per rollout; review-round always goes to reviews.jsonl, tuning to tunings.jsonl, the
weekly reading's kinds (watch, watch-raised, proposal, reflection, time-lost) to reflections.jsonl, and the Grade log's
kind (grade) to grades.jsonl. All four names are RESERVED: refused as a rollout slug and as a carried `from`.

tunings.jsonl holds one line per by-hand Reflection, plus one `close` line per rollout, at its completion ceremony or
its supersede, plus one `auto` line per knob the weekly reading lands or reverts (skills/reflect/scripts/tune.py is
its one emitter; score.py reads it for baselines and the applied tally; tune.py and
skills/reflect/scripts/close-score.py read it to refuse a second close line; tune.py `--auto`/`--revert` and
skills/reflect/scripts/reflect.py read it for a key's last move and the auto lines): the scored window, its ten scores
(the two headlines, Hands-off rate and Quality, beside the Guardrails' and the run's numbers) and the Tunings Lachy
picked (`applied`, most often []). A tuning line is `v` 2 (p21-2); a v1 line carries the first seven scores only and
still serves as a baseline, its missing keys read as no baseline.
- Close (p21-6, ADR 0037 d4): close-score.py runs the script half of a Reflection at a rollout's close and writes its
  line through `tune.py --record-only --close <completion|supersede>`, which stamps `close`. One close line per
  rollout: a non-voided line with a `close` for that rollout refuses a second. A by-hand Reflection's line never
  carries `close`, so it neither blocks a close line nor is blocked by one.
- Auto (p21-7, ADR 0037 d5): `tune.py --auto|--revert --reflection <id>` stamps `auto` and `reflection`, and a revert
  stamps `reverts` (the auto line it undoes). An auto line never carries `close`, and a close line never carries
  `auto`. A close line's `applied` is [], so it never moves a key and never counts toward `agreeing` or `agreed`.
  `agreeing` stays score.py's count (earlier applied Tunings with the same rule and direction); `agreed` is the
  weekly agreement (the Agreement rule below), carried on each entry of an auto landing.
- Serial (p24-4, ADR 0040): a serial rollout's close line (close-score.py's serial path, through
  skills/reflect/scripts/serial-score.py and `tune.py --record-only --close completion`) carries `shape: serial` and
  `repo: null`, since a chain has no one repo: its parallel-only scores (tokensPerMerge, setAsideRate, conflictRate,
  quotaStalls) and reviewChurn are null. It is a close line only (applied [], no binding, voids, auto, reflection or
  reverts), never a baseline (score.py's load_tunings reads only a string repo) and never a move of a key.

grades.jsonl holds the Grade log (p25-4, ADR 0041; CONTEXT.md **Grade log**): one `grade` line per graded task per
estate pass or schedule Pre-flight (ADR 0047), every line of a pass sharing its `pass` id, its `digest` and its ts.
skills/_shared/scripts/estate-dispatch.py `log` is its one writer (orient-all § 2 step 7, never on a dry run, and
schedule § 1.5 on every run that grades, all but an orient-all fork, whose estate pass logged them) and
skills/reflect/scripts/grades.py its one reader (the weekly reading's grade accuracy, joined to outcomes at read
time). A schedule run that regrades a task the estate pass graded ends that estate episode as `regraded`, normally
undispatched and so outside the rate; a Pre-flight grade's `held` counts holds on dependencies outside the rollout
too. A grade line carries no rollout, and a task:
a graded task whose name normalise_slug refuses (a vault note named with spaces or capitals) has no line, `log` skips
it and reports it.

reflections.jsonl holds the weekly reading's lines (skills/reflect/scripts/reflect.py is its only writer, and tune.py
reads it for the agreement, the load hold and to refuse a closed Reflection): a `watch` line per (Reflection, Watch), a
`watch-raised` line per decided Watch, a `proposal` line per (Reflection, Tuning) at each altitude, a `time-lost` line per
(Reflection, source) (the Time-lost ledger, p29-11: reflect.py `ledger` its one writer), and one `reflection` line that
closes the Reflection. None carries a rollout or a task.
- Baseline: the next Reflection on that repo (matched ignoring case) compares against the `scores` of the line with
  the latest window.activeEnd at or before its own window.activeStart, preferring a line not marked partial; a
  line whose activeEnd is null never qualifies. Comparing active spans, not ts or until, keeps a Reflection run late
  (after the next rollout began) a valid baseline for that rollout.
- Void: when tune.py's config write fails after its line landed, it appends a second line carrying
  `voids: <the first line's id>`, an empty `applied` and the same scores. Readers drop a voided line's
  `applied` (it never took effect) and keep its scores as a baseline.

Slugs: --rollout, --task and carried's `from` accept a bare slug, [[slug]], [[slug|alias]], a
path-qualified [[dir/slug]] or a note path ending .md (its stem). The result is lowercased and must match
[a-z0-9][a-z0-9._-]*, so merge-task.sh passes a note path or a wikilink straight through and a task's
events never split between `Foo` and `foo`.

Line format: one JSON object per line, ASCII only, compact separators, no NaN or Infinity, at most 16 KiB
with its newline. The common keys come first, in this order:

    v        the kind's schema version: KIND_VERSIONS, else VERSION (1). Only tuning is 2 (p21-2: its ten scores).
    ts       UTC, millisecond precision, `Z` suffix: 2026-10-03T22:23:00.000Z. The writer stamps it; an
             explicit --ts / ts= is converted to UTC and must match, on every python version,
             YYYY-MM-DD(T| )HH:MM[:SS[(.|,)fraction]] then Z, +HH, +HHMM or +HH:MM (a naive one is
             refused; the fraction is cut to microseconds). So `date +%Y-%m-%dT%H:%M:%S%z` works.
             Any other ISO timestamp field a caller adds must be UTC `Z` too; call-journal's
             startTime is the one epoch field (the journal's own epoch-ms integer, verbatim).
    host     the hostname up to its first dot
    rollout  the rollout slug (null only for review-round, grade and the five reflections.jsonl kinds; a tuning's is
             a provenance stamp)
    task     the task slug, or null
    kind     one of the kinds below

The kind fields follow. Unknown extra keys are allowed (an optional `harness`, say); a key that collides
with a common key is refused.

Kinds (T: a task is required; `?` marks an optional field; every enum is closed):

  slot-taken      T  settings{parallel_ceiling (int >= 1), max_review_rounds?, max_iterations?,
                     max_plan_rounds? (ints >= 1), rung? (str)} (the effective values after per-task
                     overrides); start? (start | restart | revise | hand-back | resume); carriedFrom? (slug);
                     cap? {away (bool), n (int >= 1: the Mac-wide cap in force, the Away cap while Away, else the
                     Trickle), file (fresh | missing | stale | unreadable: the Away state file's reading)} (exactly
                     those keys; p29-8, ADR 0049: the cap the Slot started under, so a Reflection tunes it)
  run-bound       T  runId, journalDir; call? (task | revise | integrate | resume); resumedFrom?
  slot-freed      T  outcome (ready | set-aside | completed | lost | stopped | failed); stamp? (call-end | fallback);
                     reconciledAt? (a UTC Z stamp). p29-12: reconcile's call-end stamp, under Reading the record
  ready           T  pr? (url or number); stamp?; reconciledAt? (as slot-freed)
  set-aside       T  stage (plan | implement | verify | review | integrate | gate), reasonClass (a string,
                     not checked as an enum; reconcile-rollout.py's table writes quota | call-failed |
                     merge-task | declined | prepare | revise-stopped | transient | gate | needs-human |
                     plan-rejected | review-rounds | approved-without-pr | integration-conflict |
                     integration-red | integration-set-aside | blocked, where needs-human, p16-3, is a stop on a
                     question for a person, never a plan or review round run out, and integration-conflict and
                     integration-red, p27-4, are an integrate set-aside opening the engine's named markers: an
                     Integration conflict, `integration: conflict unresolved in …`, and a verifier red at
                     Integration, `integration: verifier red: …`); setAsideAt? (run | integration | gate); stamp?;
                     reconciledAt? (as slot-freed)
  lane-taken      T  (no fields)
  lane-freed      T  release (merge | set-aside | reject | halt); path?; triggers? (list of str);
                     conflict? (bool: `conflict` in triggers — a conflict Integration resolved, or, p27-4, an
                     unresolved Integration conflict that set the task aside)
  merged          T  pr?; readOnly? (bool); stamp?; reconciledAt? (as slot-freed)
  paused             mode (soft | hard | sign-off: reconcile-rollout.py await-sign-off, the queue left only gates for
                     Lachy and closed, ADR 0034)
  resumed            (no fields)
  hold-started       hold (merge | git-env | race)
  hold-ended         hold (merge | git-env | race)
  idle-slots         reason (dependency | solo | pause-drain | queue-tail | awaiting-hand-back |
                     hold-merge | hold-git-env | hold-race | hold-trickle: a row waits on the machine-wide Trickle,
                     execute away.md | hold-away-cap: a row waits on the machine-wide Away cap, execute away.md |
                     hold-last-start: a row the last starts hold toward the Morning, p28-2 | hold-pr: a row waits
                     on a PR's hold_until, vault-grammar § Hold until | hold-heat: a row waits for the Mac to cool,
                     the Heat hold, execute away.md § Heat); free (int >= 0); settings (as slot-taken)
  away-night         morning (a UTC Z stamp, to the second: M, the Morning the last starts looked toward while Away
                     ran to it). p28-2, the night record (execute away.md § The night record): reconcile-rollout.py
                     `next` writes one per (rollout, M) on a call off --dry-run while the last starts apply, so a
                     Reflection counts the nights, zero-hold nights included.
  last-start-held T  morning, scope (the task note's kind, `unscoped` with none), history (int >= 0: the kind's
                     past runs); usualMinutes? (int >= 1: the ceiling of their median, only at 3 runs or more). p28-2:
                     one per (task, M), for each row a call's final holds hold on `last start:`.
  ran-past-morning T morning, slotTakenAt (a UTC Z stamp: the open Slot's first slot-taken ts), scope, history;
                     usualMinutes? (both the kind's reading at the write, so a Reflection tells a fallback overrun
                     from an underestimate). p28-2: one per (task, M), for each task whose Slot was open at a marked
                     Morning (taken before it, not freed at or before it), read from this record's Slot intervals.
  quota-stall        stage?; detail?; runId?, call? (task | revise | integrate | resume: the task's latest run-bound,
                     omitted when it has none; p29-10); stamp?; reconciledAt? (as slot-freed)
  auto-retry      T  stage (plan | implement | verify | review | integrate: the stage of the block it re-enters,
                     the task's latest set-aside line's), setAsideAt (run | integration), retryClass (agent | infra
                     | quota), used (int >= 0: auto_retries_used after this retry; a quota retry leaves it), budget
                     (int >= 1: the resolved auto_retries); fingerprint? (the block's run sha); reviewRounds? (int
                     >= 1: the raised max_review_rounds); quotaRetries? (int >= 1: quota_retries_used after a quota
                     retry). p16-4, ADR 0033: reconcile-rollout.py auto-retry, execute's automatic retry of a
                     set-aside task.
  completion-verify  result (green | rerun | flake | red | noslot | unrun | stopped | heat), rc, sha, attempt (int 1 or 2); log?,
                     followup?
                     (estate ADR 0009 d6: reconcile-rollout.py completion-verify, one line per run of a rollout's
                     completion_verifier on merged origin/<default> at its completion ceremony (a serial chain's:
                     its checkout's HEAD, ADR 0055); rc the run's
                     verbatim, 0-255, noslot, heat or absent; rerun is attempt 1's red, re-run on the same sha; flake
                     a green attempt 2 after it; noslot (no verify slot), unrun (verify never got going, the
                     env_bootstrap never let the suite run, or a git-env trip fell inside the window), stopped (a
                     signal stop: a TaskStop, a hard pause, a room stop) and heat (the Mac was too hot to run the
                     suite, the Heat hold) no verdict, the attempt runs again; followup
                     the fix task a final red filed; ADR 0052: completion-verify --run writes it).
  verify-skipped  T  repo (the origin's owner/name, else the repo path), paths (at most 200 paths, the move's first),
                     pathsTotal (int >= 0: every path the move changed); base?, main?, head? (the green run's base, the
                     new main and the merge commit M that merges with no re-run), globs? (at most 64: the globs the
                     proof held for). p29-3, ADR 0045: lead-integrate.py prepare's `skip`, written at the decision,
                     before the push: main moved only in the repo's Inert paths and the Inert proof held on M's tree.
  inert-proof-failed T repo, paths, pathsTotal (as verify-skipped), readers (at most 20 {glob, path, kind, line?, text?,
                     origin?}: kind name | walk | link | tool | symlink | unprovable | submodule, line an int >= 0,
                     text at most 120 characters, origin repo | cwd | path | input | open | depth; empty only beside an
                     error); error? (at most 200 characters: the inert check raised, so no skip and nothing proved),
                     base?, main?, head?, globs? (as verify-skipped), failed? (at most 64: the globs that failed). p29-3:
                     prepare's path test passed but the proof found a reader, or the check itself failed (`error`), so
                     the verifier runs as before.
  flake           T  test, repo, sha, site (task | integrate | integration | race); followup?, count? (int >= 1)
                     (p29-9, ADR 0050: one line per new Flake log line, the test a verifier run in a rollout failed
                     outside the task's diff that passed its named re-run and a confirming full run on the same tree;
                     repo the Project root's origin owner/name; sha the tree's; site where the run was: a task call's
                     verifier loop, an integrator's, the lead's Integration verify or a RACE re-verify; followup the
                     follow-up task it was filed under, count that task's Flake log lines so far.
                     reconcile-rollout.py's _record_flakes writes it, from an engine row's flakes or record-verify).
  suite-timeout   T  site (integration | race), run (first | named | confirm), seconds (int >= 1); sha?
                     (p29-9, ADR 0051: a lead verify whose run hit its deadline, logged as load, never a Flake: the
                     first run, the Flake check's named re-run or its confirming run, and the seconds it was given.
                     reconcile-rollout.py record-verify writes it).
  call-journal       runId; status (the journal's own status, verbatim); mode?; tokens?, durationMs?,
                     agents? (ints >= 0); startTime? (int >= 0: the journal's epoch ms, verbatim)
  review-round       repo, head, digest; doc?; mode?; effort?; findings?, original?, regression?
                     (ints >= 0); verdict?. No rollout, no task; lands in reviews.jsonl.
  review-verdict  T  round (int >= 1), verdict (approve | changes), findings, original, regression (ints >= 0;
                     original + regression <= findings, the rest unclassified), digest (verdict_digest of the
                     verdict and its bullets); head? (the PR head the judge judged, resolved to a full sha in the
                     task tree; omitted when the judge gave none); stamp?; reconciledAt? (as slot-freed: the round
                     was judged inside the call, so its line is at the call's end). One line per judged
                     master-review round, written by reconcile-rollout.py from the row's reviewVerdicts; lands in
                     <rollout>.jsonl.
                     Engine rounds are reviewLoop's REVIEW_VERDICT rounds only: an Integration re-review
                     rejection uses a review round but writes no line, so `round` skips it (r1, r2, r4).
  carried         T  from (the old rollout's slug), to (set to the new rollout). Appended to both
                     <from>.jsonl and <to>.jsonl, each line's `rollout` the file it sits in; each append
                     is best-effort on its own.
  answer-recorded T  answerKind (needs-you | decision: record-answer's --kind); form? (hand-back |
                     awaiting-repair | left: its --form, none for a `(block -)` answer); raise? (max_review_rounds |
                     max_plan_rounds | max_iterations: its --raise); pr? (bool: --pr was given). p21-2:
                     reconcile-rollout.py record-answer, Lachy's Recorded answer.
  gate-signed     T  standing (bool: false for a bare approve-gates sign-off, true for the gates --standing
                     covered); gates (int >= 1: how many it signed). p21-2: reconcile-rollout.py approve-gates.
  handed-back     T  via (answer | descope | retry: hand-back classifies itself, first match: a standing
                     `descope_armed:`; --answer, a live answer spent or a fresh `(block -)` entry; else retry); arm
                     (run | integration: the stage it re-enters). p21-2: reconcile-rollout.py hand-back, never
                     auto-retry (its own event names it).
  race-decided    T  mark (RACE | UNVERIFIED); by (resume | hand-back | auto-retry: the verb that moved the task
                     because Lachy's `RACE decided:` line lifted its hold). At most once per task per record.
                     p21-2: reconcile-rollout.py _record_decision.
  tuning             id, repo, window{since, until, activeStart?, activeEnd?, partial?}, scores{throughput,
                     runningHours, merges, tokensPerMerge, setAsideRate, conflictRate, quotaStalls, handsOffRate,
                     quality, reviewChurn}, applied (a list of at most 8 {key, from, to, ranAt, rule, evidence,
                     agreeing, agreed?}); binding? (slot-bound | lane-bound | quota-bound | trickle-bound (p28-6) |
                     dependency-bound | none-clear); voids? (the id of the line this one voids); close? (completion | supersede: the close
                     that wrote it, through close-score.py and `tune.py --close`; one per rollout; never on a by-hand
                     Reflection's line); auto? (true only: `tune.py --auto` or `--revert`, the weekly reading's own
                     landing); reflection? (the weekly reading's r- id, present exactly when auto is); reverts? (the
                     t- id of the auto line a revert undoes: auto, with one applied entry); shape? (serial only: a
                     serial rollout's close line, p24-4). A rollout is required and a task is refused;
                     lands in tunings.jsonl, `v` 2. repo: a non-empty string (owner/name), or null on a `shape:
                     serial` line and only there. window: since and until UTC `Z` stamps, activeStart and
                     activeEnd a UTC `Z` stamp or null, partial a boolean, no other key. scores: exactly the ten
                     keys, each a finite number or null, with merges an integer >= 0, quotaStalls an integer >= 0
                     (null only on a serial line) and handsOffRate in [0, 1] (quality is null when nothing landed
                     or no Escape source was read, p21-4; reviewChurn when no review round was recorded, p21-3). A
                     serial line has applied [] and a close, and no binding, voids, auto, reflection or reverts.
                     applied: key
                     one of parallel_ceiling, max_review_rounds, max_iterations, max_plan_rounds; from, to
                     and ranAt integers >= 1 with from != to; rule a string of at most 64 characters;
                     evidence one of at most 300; agreeing an integer >= 0; agreed (an integer >= 1, on every
                     entry of a non-void auto landing and on no other line); no other key. Never auto and close on one
                     line.
  watch              id, rule, shape, rollouts, count, reflection; ledgerClass? (p21-7: one per (Reflection, Watch); id
                     is watch_id(rule, shape); rule and shape stripped, each at most 120 characters; rollouts 1 to 64
                     slugs, none reserved, every rollout where the Reflection saw it; count an integer >= 1; ledgerClass,
                     p29-11, one of TIME_LOST_CLASSES: the Time-lost ledger's Watch on that class, written by reflect.py
                     `ledger` alone, its rollouts the class's top contributors). No rollout, no task; lands in
                     reflections.jsonl.
  watch-raised       id, reflection, via (recurring | confirmed | declined: Lachy's yes to a recurring Watch, his yes
                     to a Watch to confirm, or his no; any of them closes the Watch's cycle). No rollout, no task;
                     lands in reflections.jsonl.
  proposal           id, altitude (knob | rule | bug), reflection, rollouts; repo?, key?, rule?, shape?, direction?,
                     from?, to?, ranAt?, landed?, auto?, tuning?, reverts?, held?, vaultTask?, filed?, fixes? (per
                     altitude: a knob needs repo, key, rule of at most 64, direction 1 or -1, from, to and ranAt
                     integers >= 1 and landed, its id knob_key(repo, key, rule, direction); a rule needs rule, shape
                     and vaultTask, a bug rule, shape, vaultTask and filed, each id watch_id(rule, shape); auto is true
                     only, on a landed knob or a filed bug; held only on an unlanded knob; landed only on a knob and
                     filed only on a bug). No rollout, no task; lands in reflections.jsonl.
  grade           T  pass, digest, project, grade, agentGrade, shape, size, decisions, low, held, gates; raised?, rank?,
                     linked? (p25-4, ADR 0041: one line per task an estate pass grades, from estate-rank.py's tasks[]
                     row, whose name is a slug (`log` skips and reports any other); pass a g- id and digest 12 lowercase
                     hex, both shared by the pass's lines; project the task's home; grade and agentGrade each one of
                     Ready | One call | Grill | Orient, the ranker's grade after the raise and the agent's own; shape
                     parallel | serial | session; size S | M | L; decisions and low integers >= 0, the count of his
                     decisions (owner yours, ADR 0054: a decision ruled for him is never counted, so lines before ADR
                     0054 are not comparable) and those of low confidence, low <= decisions; held a boolean, the task
                     held by a dependency; gates a list of distinct gate kinds, spend | credential | irreversible,
                     possibly empty; raised a non-empty list of distinct raise whys, decisions | confidence; rank an
                     integer >= 1, absent for Orient; linked the scan row's rollout slug at grade time, never a reserved
                     name). No rollout; lands in grades.jsonl.
  reflection         id, since, until, rollouts, escapesOnly, counts, quiet; decisionTask?, cadence?, repairsOnly?
                     (p21-7: the Reflection's one closing line; since and until UTC Z stamps; rollouts, escapesOnly
                     and repairsOnly lists of slugs: the rollouts read, those not read that hold an in-window
                     Escape, and those not read that hold only in-window repair lines, repairsOnly written only when
                     non-empty; counts exactly sightings, newWatches, rules, bugs, filed, knobs, landed, reverted and
                     breaches, each an integer >= 0; quiet a boolean; cadence 7 or 14, absent read as 7). No
                     rollout, no task; lands in reflections.jsonl.
  stopped            cause (usage-limit | dead-lead | mac-restart | mac-sleep | halt | watchdog), inferred (a bool:
                     false for a stop a live process logged as it began, true for one a later entry found), calls (at
                     most 64 {task, runId?, call?}, call task | revise | integrate | resume: the calls the record shows
                     in flight at the stop's start); at? (a UTC Z stamp: the stop's start, required when inferred), boot?
                     (a UTC Z stamp: the boot a mac-restart found, only there), wake? (a UTC Z stamp: a mac-sleep's wake,
                     required there and only there, never before at), reason? (at most 200 characters: a halt's reason,
                     a room stop's line). p29-10, ADR 0051: the run stopped for a cause other than Lachy's pause (the
                     stop model, below), never a `paused` line.
  lead-entry         by (lachy | stage | watchdog | heartbeat | repair: what opened the lead's entry); session? (its
                     CLAUDE_CODE_SESSION_ID), stop? (usage-limit | dead-lead | mac-restart | halt | watchdog | pause:
                     the stop this entry resumes from, absent when the lead was alive). p29-10: reconcile-rollout.py
                     record-entry, one per loop entry and per heartbeat tick.
  suite-started      suite (s- and 16 lowercase hex, shared with its suite-ended), by (task | integration | race |
                     completion), runner (agent | lead), sha (the tree's HEAD), dirty (a bool: tracked changes on
                     it); load? (exactly 3 finite numbers >= 0: the 1, 5 and 15 minute load average), diff? (12 hex:
                     the first of the sha256 of `git diff HEAD --binary`, only on a dirty tree), waited? (seconds >= 0:
                     the verify-slot wait), running? (an int >= 0: the Mac-wide count of running Rollout tasks). A task
                     is optional: a completion suite has none.
  suite-ended        suite, by, runner (as suite-started), outcome (green | red | timeout | stopped | unrun | noslot |
                     heat: the Heat hold, verify-slot.py contract 7, stopped the run, no verdict, or held it past the
                     slot wait), seconds (>= 0: the run, after any slot wait); load?, rc? (an int 0-255, never on noslot
                     or heat), failing? (at most 50 names of at most 200 characters each, read from the run's output on
                     red or timeout), timeout? (seconds >= 0: the deadline, only on timeout), step? (env_bootstrap |
                     verifier: where a deadline, a bootstrap or a heat stop ended it), sha?, waited?, running? (as
                     suite-started).
  time-lost          id, source, since, until; month?, reflection?, hours?, recorded?, rank?, top?, byCause?, rollouts?,
                     other?, events?, streak?, audit?, ranges?, cites? (p29-11, ADR 0051: the Time-lost ledger, one line
                     per (Reflection, source), reflect.py `ledger` its one writer; skills/reflect/scripts/ledger.py's
                     docstring holds the model. id a tl- id; source record (the week's row, summed by ledger.py from the
                     Run record), audit (a Monthly audit's row) or baseline (the 2026-10-21 audit, written once); since
                     and until UTC Z stamps, since <= until; month YYYY-MM, the Melbourne month of the reading's until,
                     required on an audit or a baseline line; reflection an r- id, required on a record or an audit line;
                     hours exactly the six TIME_LOST_CLASSES, each a finite number >= 0, required on a record or an
                     audit line and on no other; recorded, audit only, the same six; rank, audit only, the six classes
                     each once; top, record only, a class or null; byCause {class: {cause: hours}}, each cause in
                     TIME_LOST_CAUSES of its class; rollouts {class: at most 8 [slug, hours]}; other {cause: hours},
                     each cause in TIME_LOST_OTHER; events {name: an integer >= 0}; streak, record only, an integer >=
                     0; audit, required on an audit line and only there, {sources (1 to 8 {source, read, why?}), entries
                     (at most 16 {class, cause, rollout, from, to, hours, what, evidence}), gaps (at most 8 {what,
                     evidence})}, the caps sized so a full audit of plain text fits the 16 KiB line (text JSON escapes
                     can still overflow it, and ledger.py's audit_line() refuses that first); ranges and cites,
                     baseline only, lists of at most 16 objects). No rollout, no task; lands in reflections.jsonl.
  base-moved      T  repo, pr, base, main (the refused integrated base and the live main merge-task read), inertOnly
                     (true | false | null: null only beside an error), moversTotal (an int >= 0), movers (at most 20
                     {sha, kind, rollout?, task?, pr?, source?}, oldest first: kind rollout | peer, source record |
                     note); nonInert? (at most 20 paths), pathsTotal? (an int >= 0), globs? (at most 64: the Inert
                     globs read), refusal? (an int >= 1: merge-task's refusal count), error? (at most 200 characters).

There is no ceiling-changed kind, and it is refused: the settings stamped on every slot-taken and
idle-slots replace it, which keeps `next` stateless and also covers round caps and per-task overrides.

Reading the record (the writers are reconcile-rollout.py's verbs and git-env-canary.py, p15-2; that module's
docstring lists each verb's events and the stage, reasonClass and idle-reason tables):
- Pairing. A Slot is slot-taken .. slot-freed (or a `carried` line in the from-file), per task; the lane is
  lane-taken .. lane-freed; a hold is hold-started .. hold-ended per (hold, task); a pause is paused ..
  resumed. A slot-taken while that task's Slot is open is the same Slot and keeps the first `start` (a
  Lost-call restart's `resume`, a restart after a dead lead). A slot-freed or lane-freed with nothing open
  for that task is ignored. A lane-taken while the same task holds the lane is the same holding; while
  another task holds it, that holding ends there, flagged as unrecorded. A hold-started while that (hold,
  task) is open is the same hold. A lane-freed also closes the task's open merge hold. A paused while paused
  is the same pause; a resumed with no pause is ignored. A `carried` line in the from-file (its `rollout`
  equals its `from`) closes that task's Slot, lane and holds there. Anything still open at the record's last
  line ends there and is flagged.
- slot-freed outcome: ready (approved with a PR), set-aside, completed (a read-only approval, or an
  in_progress note whose PR `resume` found merged), lost (a dead call's lead-written row), stopped (a hard
  pause, a defer or a carry ended it); `failed` is reserved.
- slot-taken start: start, restart (a stalled note restarted), revise (a seeded revise), hand-back (the
  restart after a hand-back, an approve-gates sign-off, a descope or a run-stage automatic retry: auto-retry,
  p16-4, stamps `handed_back:` through hand-back's own transition, so its restart follows its auto-retry
  event), resume (a Lost-call or signed-gate resume).
- set-aside stage is where the task stopped; setAsideAt is where it re-enters (merge-task's exit 1 reads
  stage integrate, setAsideAt run).
- Call-end stamps (p29-12). The lead reconciles a call's row at its next turn, which can come hours after the call
  ended (a lead held on a hold, or idle). So reconcile-rollout.py `reconcile` writes the events of a row that ends a
  Slot (slot-freed, ready, a read-only approval's merged, set-aside, quota-stall, review-verdict) at that call's own
  end, read from the journal of the call bound to the task's open Slot, with `stamp: call-end` and `reconciledAt`,
  its own clock (when the lead turned to the row); with no end readable it writes them at its own clock with `stamp:
  fallback` (and a ready or merged on any other row is a fallback too). Such a line's ts can be earlier than lines
  written before it, so read the record by ts, as score.py does. That is also why the end must lie at or after the
  Slot's latest slot-taken, a re-take included: a call-end ts earlier than a slot-taken in the same Slot would put the
  slot-freed before that slot-taken, and every reader that reads by ts would split the Slot in two, the second never
  freed. An end earlier than it is an earlier attempt's (a restart re-took the Slot, its launch failed or its resume
  never rewrote the journal), so the row falls back. A slot-freed's `reconciledAt` is when the lead released the
  Slot: score.py reads the Slot to it, so the lead's absence after a call still reads as lead absent, while the
  night record (`next`) reads the Slot as ended at the call's end. The lane's events stay at the reconcile's clock,
  unmarked: the lane is the lead's (ADR 0030). A line from before p29-12 carries no `stamp`: its ts is the
  reconcile's clock.
- Idle Slot time is a span. A Reflection derives it from slot-taken / slot-freed pairs against the ceiling
  stamped on each event. An idle-slots event is a reason marker labelling the span it falls in: a change
  of reason splits the span, a repeat is harmless, a span with no marker reads as "unexplained".
  `awaiting-hand-back` also labels a span in which execute's automatic retry (p16-4, ADR 0033) waits out a
  quota or infra cool-down with nothing queued: `next` is stateless and never reads the retry verdict. A
  Reflection tells the two apart by what precedes the slot-taken start=hand-back that ends the span: the task's
  auto-retry event for a cool-down; a `handed-back` (and, for an answered block, the `answer-recorded` before it)
  or a `gate-signed` for a human's hand-back or sign-off. A record from before p21-2 carries neither, so its human
  hand-back has none.
- call-journal: for each runId, use its latest line with a terminal status (completed, failed, killed,
  stopped, cancelled); with none, use its latest line and treat the call as in flight. The writer folds
  under an exclusive flock on the file and skips a fold when that runId already has a terminal line, or
  when the fold equals that runId's latest line (ts and host aside). So a mid-run Reflection records partial
  numbers, a close Reflection's terminal fold always lands, and re-folding is safe. An unknown status counts
  as non-terminal: appended and later superseded, never dropped. Write call-journal only through this
  module, so every writer takes part in the lock.
- Human acts (p21-2; a Reflection's Hands-off rate, skills/reflect/scripts/score.py). Each is recorded by the verb
  that acts on it, never model-written. Acts: `answer-recorded` (a Recorded answer); `gate-signed` standing=false (a
  bare approve-gates sign-off); `handed-back` via=retry (a "retry [[task]]" or repair hand-back that re-enters a block
  with no answer); `hold-started` hold=merge, any merge hold: the record carries no reason, so a `--gated` hold and an
  exit-7 `review required:` hold both count; `race-decided`. Not acts: `hold-started` hold=race (the RACE procedure
  opens it on every merge-task exit 5 and a green re-verify's mark-done ends it with no decision: only the
  `race-decided` a verb records when Lachy's `RACE decided:` line lifts the hold is his act); `gate-signed`
  standing=true (the Standing approval); `handed-back` via=answer (the answer is the act) and via=descope (an
  automatic descope's re-entry); `auto-retry`. via=answer means a live answer of any block spent, `--answer`, or a
  fresh `(block -)` entry, not this block's answer only.
- verify-skipped and inert-proof-failed (p29-3, ADR 0045): written by execute's lead-integrate.py prepare (through
  reconcile-rollout.py's _event), read by skills/_shared/scripts/inert-paths.py `propose`'s drop rule across every
  rollout's record for the repo (case ignored), in ts order: a verify-skipped line is a pass for each of its `globs`;
  an inert-proof-failed line is a failure for each glob in `failed` (else each reader's glob) and a pass for the rest of
  its `globs`; a line with an `error` is neither. score.py and reflect.py match kinds explicitly and read neither.
- review-round: dedupe on (repo, doc) when doc is present, else on (repo, head, digest), keeping the latest line
  (p15-7's emitter is idempotent per (repo, doc)).
- review-verdict: one line per verdict_key, (task, round, head) when the line carries a head, else (task, round,
  digest). Keep the first line per key. The writer (reconcile) skips an entry whose key the record already holds,
  so a signed-gate or Lost-call resume's replayed rounds are written once; readers apply the same key, so a
  duplicate that slips in counts once. Two head-less lines for one round with different bullets stay two (a fresh
  re-judge after a cache miss, a known overcount); two head-less approve lines for one round collapse (rounds
  only, no findings).
- tuning: see tunings.jsonl under Files (the baseline, void, close and auto rules).
- The Watch rule (p21-7, ADR 0037 d2 and d5). A Watch's id is watch_id(rule, shape), the first 8 hex of sha1 over the
  stripped rule, a newline and the stripped shape (Chorus's watch_id, re-implemented), so a pattern named the same
  way is one Watch. A Reflection writes one `watch` line per Watch, naming every rollout where it saw it (a later
  line from the same Reflection only ever extends that set). A cycle opens at a sighting and closes at any
  `watch-raised`, whatever its via: recurring or confirmed for Lachy's yes (a rule grill filed), declined for his no.
  A sighting after a close opens a new cycle that recurs only on two distinct rollouts of its own, so a declined rule
  returns only when two later rollouts show it afresh. Within a cycle each Reflection counts by its latest line, the
  cycle's rollouts are the union and its count the sum. Recurring: two or more distinct rollouts in the open cycle,
  one of them this Reflection's. A Watch is new only at its id's first-ever `watch` line. A Watch whose lines carry
  `ledgerClass` (the Time-lost ledger's, p29-11: reflect.py `ledger` alone writes it) counts readings, not rollouts:
  within a cycle its sightings are the Reflections with a line, recurring is two or more of them, one this
  Reflection's, so a declined class returns only when two later readings show it on top again.
- The Agreement rule (p21-7, ADR 0037 d5: a knob lands once three Reflections agree). For K = knob_key(repo, key,
  rule, direction) of the current proposal P, from rollout X in Reflection R: the key's last move is the latest
  non-voided tuning line for the repo (case ignored) with an applied entry on `key`, any rule or direction (a pick, an
  auto landing or a revert); the earlier lines are the knob `proposal` lines with id K in reflections.jsonl, in file
  order, each after the last move, from a Reflection other than R that has its `reflection` line (and not the
  Reflection whose auto line made the last move: its lines were that move's evidence). Walking them with an empty set
  seen, a line agrees when it names a rollout not yet seen, and its rollouts then join seen. The agreement is the
  agreeing lines plus one when X is not seen; a knob lands at 3. tune.py's auto_check computes it.
- The cadence rule (p21-7 and p21-8, ADR 0037 d6). A `reflection` line's `quiet` is newWatches, rules, bugs and
  breaches all 0. The quiet streak is the number of `reflection` lines at the end of the file, in file order (the
  first line per id), whose quiet is true; the cadence is 14 days (fortnightly) when the streak is 3 or more, else 7
  (weekly). So three quiet Reflections in a row move the reading to fortnightly, a fourth keeps it there, and any that
  is not quiet moves it back to weekly at once. cadence() computes it, and readers (reflect-due.py) take it from the
  quiet flags, never from a written value. A line's `cadence` records the rule's value as that Reflection closed it,
  its own line counted (reflect.py's close writes it on every line, so each change is on a record line); absent (a
  line from before p21-8) reads as 7. A Monthly audit's gaps (a `time-lost` audit line's) never count against `quiet`:
  the audit runs at either cadence, and like a held trade a gap leaves the week quiet (ADR 0051, p29-11).
- The night record (p28-2): a night is assembled by its `morning`. Its record is the union of the away-night,
  last-start-held and ran-past-morning lines sharing that `morning` across every <rollout>.jsonl: the marker is
  per (rollout, M), the others per (task, M), each written once (the writer checks the record first).
- The time-lost ledger's kinds (p29-10, ADR 0051): stopped, lead-entry, suite-started, suite-ended and base-moved,
  every one written by a script, never by a model. score.py and reflect.py's other readers skip these kinds
  (LEDGER_KINDS); reflect.py's Time-lost ledger (ledger.py) reads them; a score never does. Their caps (64 calls, 50 failing names of 200 characters, 20 movers, 20 nonInert paths, a
  200-character reason) keep each line well under 16 KiB.
- The stop model. A stop is the run halting for a cause other than Lachy's pause. It is its own kind, never `paused`:
  every reader reads paused .. resumed as his pause, so a stop written as one would change what existing lines mean
  (ADR 0043). A stop starts at its `at`, else its ts. A mac-sleep ends at its `wake`. Any other stop ends at the first
  of the next lead-entry, the next non-sleep stopped line's start and the next paused line; with none of those (a lead
  on a pre-p29-10 Engine snapshot writes no lead-entry) at the next slot-taken, lane-taken or run-bound, else it stays
  open and is flagged. Where a sleep overlaps another stop, the sleep owns the overlap. `calls` are those in flight at
  the stop's start: killed by a usage-limit stop, a dead lead, a restart or a Watchdog recovery, carried on through a
  halt, suspended through a sleep. A lead-entry with `stop` is a resume and its `by` what restarted the run; one
  without `stop` marks the lead alive. The heartbeat writes one every tick (20 minutes), so an inferred dead-lead or
  mac-restart starts at most one tick after the lead's last sign of life (a line stamped at its call's end, p29-12,
  is one at its reconciledAt, the lead's write). An inferred line's ts is its write time, never backdated; `at`
  carries the past. A stop no evidence shows (the same session
  resumed hours later with no stated cause and no Mac event) is not inferred: the heartbeat's lead-entries bound it,
  and ADR 0051's monthly audit covers it.
- Stop readers: reconcile-rollout.py stop_spans() reads every stop by this model (p29-13), and an Integration log
  line's `active=` is its `duration=` less the union of the stops inside its window whose calls stop with them (all but
  a halt, which carries its calls on), so no reader prices a usage-limit stall as Integration lane work. The line is
  written when the lead reconciles the call (or logs its own Integration), before `next`, so a sleep inside it is
  usually not a line yet: _unrecorded_sleeps reads the sleeps `next` would write (machine_times since the last
  lead-entry or recorded wake, through the window test) into that union without writing them, and `next` or
  record-entry stays the writer.
- Stop writers: step-boundary.py `begin` (a room stop: usage-limit, live); the Stop-hook driver
  hooks/rollout-stop-driver.py (a § 7 halt, live; never a serial rollout's Leg and never while a pause stands);
  reconcile-rollout.py `record-entry` (every inferred stop and every lead-entry, at each loop entry and heartbeat
  tick); reconcile-rollout.py `next` (a sleep no entry follows: a mac-sleep closes itself, so `next` writes no
  lead-entry).
- Suites pair by `suite`. A suite-started with no suite-ended never finished (killed with its wrapper, the lead or the
  Mac); a suite-ended with no suite-started is a noslot or a heat (the suite never got a slot, so it never started).
  A heat stop ends its run's suite `heat`, and the restart once the Mac cools is a suite of its own. Writers:
  skills/execute/scripts/verify-slot.py `run` (an agent's suite, runner agent, the task read from a cwd under
  `<repo>/.claude/worktrees/<slug>`) and lead-integrate.py `verify --rollout` (the lead's Integration, RACE and
  completion suites, runner lead). `running` is absent on a stop by signal (no vault scan on that path).
- base-moved: one line per newly counted merge-task exit-3 refusal (merge-task.sh's record_base_moved, through
  lead-integrate.py `base-moved`), its movers the first-parent commits base..main, oldest first: a rollout's merge
  (source record: a `merged` line in any rollout's record names its PR; source note: its task note carries
  `rollout:`) or a peer's push (anything else, a PR-less commit included). "This base was already counted" writes
  none.
- Skip a line that does not parse: a crash can leave a last line with no newline, which the next append
  then merges with (a known limit; checking the tail would mean locking every emit).

Mirror contract (p15-7). The fresh-review ledger writes review-round lines without importing this module.
It must keep to: the directory chain above (the override, then XDG_STATE_HOME, then the home default);
the line format and common keys above, with rollout and task null; one O_APPEND write of the whole line,
at most 16 KiB, no lock. Idempotency is the emitter's job: one event per review doc written, checked by
its own `doc` key. This writer never dedupes or locks review-round; readers dedupe as above.

Writing: os.makedirs, then os.open(O_WRONLY | O_APPEND | O_CREAT, 0o644) and ONE os.write of the whole
line, so concurrent emitters on a local filesystem never interleave a line (not promised on network or
sync filesystems). Any failure to write (a short write, an OSError, anything unexpected) prints
`run_record: warning: cannot write <path>: <err>` and writes nothing more; the CLI still exits 0.

Exit codes: 0 written, skipped as a duplicate fold, or a warned write failure; 2 refused (an unknown kind,
a missing or out-of-enum field, a task-scoped kind with no task, a tuning with one, a grade with a rollout, a reserved
rollout or `from`, --json not a JSON object, a common-key
collision, NaN, a bad slug, a naive or malformed --ts, a line over 16 KiB, a review-verdict whose original +
regression exceed its findings, a stopped, suite-ended, base-moved or time-lost line that breaks its kind's cross-field
rules),
with one line starting `run_record: ` on
stderr and nothing written; `dir` exits 1 when the directory cannot be resolved.
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import math
import os
import re
import socket
import sys
import time

try:
    import fcntl
except ImportError:  # Windows: call-journal folds scan unlocked, with a warning
    fcntl = None

VERSION = 1
# A kind whose schema moved on stamps its own `v`; every other kind is VERSION. tuning 2: the ten scores (p21-2).
KIND_VERSIONS = {"tuning": 2}
MAX_LINE = 16 * 1024
LOCK_WAIT = 5.0
COMMON = ("v", "ts", "host", "rollout", "task", "kind")
REVIEWS = "reviews"
TUNINGS = "tunings"
REFLECTIONS = "reflections"
GRADE_LOG = "grades"
# record files that are no rollout's: refused as a rollout slug or a carried `from`
RESERVED = (REVIEWS, TUNINGS, REFLECTIONS, GRADE_LOG)
SLUG_RE = re.compile(r"[a-z0-9][a-z0-9._-]*")
# One accepted --ts shape on every python (fromisoformat widened in 3.11): date, time, fraction, offset.
STAMP_RE = re.compile(r"(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d)(?::(\d\d)(?:[.,](\d+))?)?"
                      r"(?:([Zz])|([+-])(\d\d)(?::?(\d\d))?)?", re.ASCII)
LINK_RE = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]")
TERMINAL_STATUSES = frozenset({"completed", "failed", "killed", "stopped", "cancelled"})


class Refused(Exception):
    pass


# ---- field checks ----------------------------------------------------------------------------------------
# Each returns None when the value is fine, else the reason it is not.

def _str(v):
    return None if isinstance(v, str) and v else "a non-empty string"


def _int(lo, hi=None):
    def check(v):
        ok = isinstance(v, int) and not isinstance(v, bool) and v >= lo and (hi is None or v <= hi)
        return None if ok else ("an integer >= %d" % lo if hi is None else "an integer from %d to %d" % (lo, hi))
    return check


def _enum(*values):
    def check(v):
        return None if v in values else "one of %s" % ", ".join(values)
    return check


def _bool(v):
    return None if isinstance(v, bool) else "true or false"


def _strlist(v):
    ok = isinstance(v, list) and all(isinstance(x, str) for x in v)
    return None if ok else "a list of strings"


def _pr(v):
    return None if (isinstance(v, str) and v) or (isinstance(v, int) and not isinstance(v, bool)) else "a url or a number"


def _settings(v):
    if not isinstance(v, dict):
        return "an object"
    if _int(1)(v.get("parallel_ceiling")):
        return "an object with parallel_ceiling an integer >= 1"
    for k in ("max_review_rounds", "max_iterations", "max_plan_rounds"):
        if k in v and _int(1)(v[k]):
            return "an object with %s an integer >= 1" % k
    if "rung" in v and _str(v["rung"]):
        return "an object with rung a non-empty string"
    return None


SETTINGS = _settings

CAP_FILES = ("fresh", "missing", "stale", "unreadable")  # reconcile-rollout.py _away_state's readings


def _cap(v):
    """slot-taken's cap (p29-8): the Mac-wide cap in force at the Slot's start, {away, n, file} and nothing else."""
    if not isinstance(v, dict) or set(v) != {"away", "n", "file"}:
        return "an object of exactly away, n and file"
    if _bool(v["away"]):
        return "an object with away true or false"
    if _int(1)(v["n"]):
        return "an object with n an integer >= 1"
    if v["file"] not in CAP_FILES:
        return "an object with file one of %s" % ", ".join(CAP_FILES)
    return None

# ---- the tuning kind (skills/reflect/scripts/tune.py) -----------------------------------------------------

UTC_Z_RE = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z\Z", re.ASCII)
# rollout-settings.py's KEYS (tests/run-record.test.mjs pins that the two agree).
TUNING_KEYS = ("parallel_ceiling", "max_review_rounds", "max_iterations", "max_plan_rounds")
# v2 (p21-2): the old seven, then the two headlines' and Review churn's slots. A v1 line carries the first seven.
SCORE_KEYS = ("throughput", "runningHours", "merges", "tokensPerMerge", "setAsideRate", "conflictRate",
              "quotaStalls", "handsOffRate", "quality", "reviewChurn")
APPLIED_KEYS = ("key", "from", "to", "ranAt", "rule", "evidence", "agreeing")
# p21-7: `agreed`, the weekly agreement (the Agreement rule), on every entry of a non-void auto landing only
APPLIED_OPTIONAL = ("agreed",)
MAX_APPLIED = 8
BINDINGS = ("slot-bound", "lane-bound", "quota-bound", "trickle-bound", "dependency-bound", "none-clear")
# a close line's `close` (p21-6): the close that wrote it, through close-score.py and tune.py --close
CLOSES = ("completion", "supersede")


def _utcz(v):
    return isinstance(v, str) and bool(UTC_Z_RE.match(v))


def _number(v):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return False
    return isinstance(v, int) or math.isfinite(v)


def _window(v):
    if not isinstance(v, dict):
        return "an object"
    extra = sorted(set(v) - {"since", "until", "activeStart", "activeEnd", "partial"})
    if extra:
        return "an object with no key %s" % ", ".join(extra)
    for k in ("since", "until"):
        if not _utcz(v.get(k)):
            return "an object with %s a UTC Z stamp" % k
    for k in ("activeStart", "activeEnd"):
        if k in v and v[k] is not None and not _utcz(v[k]):
            return "an object with %s a UTC Z stamp or null" % k
    if "partial" in v and not isinstance(v["partial"], bool):
        return "an object with partial true or false"
    return None


def _scores(v):
    if not isinstance(v, dict) or set(v) != set(SCORE_KEYS):
        return "an object with exactly the keys %s" % ", ".join(SCORE_KEYS)
    for k in SCORE_KEYS:
        if k == "quotaStalls" and v[k] is None:
            continue  # null only on a serial line: _check_tuning holds that rule
        if k in ("merges", "quotaStalls"):
            if _int(0)(v[k]):
                return "an object with %s an integer >= 0" % k
        elif v[k] is not None and not _number(v[k]):
            return "an object with %s a finite number or null" % k
        elif k == "handsOffRate" and v[k] is not None and not 0 <= v[k] <= 1:
            return "an object with handsOffRate in [0, 1] or null"
    return None


def _applied(v):
    if not isinstance(v, list) or len(v) > MAX_APPLIED:
        return "a list of at most %d entries" % MAX_APPLIED
    for e in v:
        if not isinstance(e, dict) or not set(APPLIED_KEYS) <= set(e) <= set(APPLIED_KEYS + APPLIED_OPTIONAL):
            return "a list of objects with exactly the keys %s (and agreed? only)" % ", ".join(APPLIED_KEYS)
        if e["key"] not in TUNING_KEYS:
            return "a list whose key is one of %s" % ", ".join(TUNING_KEYS)
        for k in ("from", "to", "ranAt"):
            if _int(1)(e[k]):
                return "a list whose %s is an integer >= 1" % k
        if e["from"] == e["to"]:
            return "a list whose from and to differ"
        if not isinstance(e["rule"], str) or not e["rule"] or len(e["rule"]) > 64:
            return "a list whose rule is a non-empty string of at most 64 characters"
        if not isinstance(e["evidence"], str) or not e["evidence"] or len(e["evidence"]) > 300:
            return "a list whose evidence is a non-empty string of at most 300 characters"
        if _int(0)(e["agreeing"]):
            return "a list whose agreeing is an integer >= 0"
        if "agreed" in e and _int(1)(e["agreed"]):
            return "a list whose agreed is an integer >= 1"
    return None


# ---- the weekly reading's kinds (skills/reflect/scripts/reflect.py; p21-7, ADR 0037 d3-d5) --------------------

# The kinds that land in reflections.jsonl: no rollout, no task (the Files rule).
REFLECTION_KINDS = ("watch", "watch-raised", "proposal", "reflection", "time-lost")
RULE_MAX = 120             # a Watch's rule and shape
MAX_ROLLOUTS = 64          # a watch's or proposal's rollouts
VIAS = ("recurring", "confirmed", "declined")
ALTITUDES = ("knob", "rule", "bug")
COUNT_KEYS = ("sightings", "newWatches", "rules", "bugs", "filed", "knobs", "landed", "reverted", "breaches")
CADENCES = (7, 14)
REFLECTION_ID_RE = re.compile(r"r-[A-Za-z0-9._-]+\Z")
TUNING_ID_RE = re.compile(r"t-[A-Za-z0-9._-]+\Z")


def watch_id(rule, shape):
    """A Watch's id: the first 8 hex of sha1 over the stripped rule, a newline and the stripped shape (Chorus's
    watch_id, re-implemented: the Watch rule)."""
    return hashlib.sha1(("%s\n%s" % (rule.strip(), shape.strip())).encode("utf-8")).hexdigest()[:8]


QUIET_STREAK = 3           # quiet Reflections in a row that relax the cadence (ADR 0037 d6)


def cadence(lines):
    """The cadence rule over reflections.jsonl's lines (dicts, file order): (days, streak). streak counts the trailing
    `reflection` lines, the first per id, whose quiet is true; days is 14 at a streak of QUIET_STREAK or more, else 7.
    A line with no string id is skipped."""
    seen = set()
    streak = 0
    for d in lines:
        rid = d.get("id") if isinstance(d, dict) and d.get("kind") == "reflection" else None
        if not isinstance(rid, str) or rid in seen:
            continue
        seen.add(rid)
        streak = streak + 1 if d.get("quiet") is True else 0
    return (CADENCES[1] if streak >= QUIET_STREAK else CADENCES[0]), streak


def knob_key(repo, key, rule, direction):
    """A knob proposal's id across Reflections: sha1 over "knob", the repo lowercased, the key, the rule and the
    direction, one per line; its first 8 hex."""
    text = "knob\n%s\n%s\n%s\n%s" % (repo.lower(), key, rule, direction)
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:8]


def _rid(v):
    return None if isinstance(v, str) and REFLECTION_ID_RE.match(v) else "an r- id (a Reflection's)"


def _tid(v):
    return None if isinstance(v, str) and TUNING_ID_RE.match(v) else "a t- id (a tuning line's)"


def _true(v):
    return None if v is True else "true (omit it otherwise)"


def _repo(v):
    """A tuning's repo: an owner/name, or null (a serial line's only: _check_tuning holds that rule)."""
    return None if v is None or (isinstance(v, str) and v) else "a non-empty string, or null on a serial line"


def _short(n):
    def check(v):
        return None if isinstance(v, str) and v.strip() and len(v) <= n else "a non-empty string of at most %d characters" % n
    return check


def _slugs(lo, hi):
    def check(v):
        if not isinstance(v, list) or not lo <= len(v) <= hi:
            return "a list of %d to %d rollout slugs" % (lo, hi)
        for x in v:
            if not isinstance(x, str) or not SLUG_RE.fullmatch(x) or x in RESERVED:
                return "a list of rollout slugs ([a-z0-9][a-z0-9._-]*, none reserved)"
        if len(set(v)) != len(v):
            return "a list of distinct rollout slugs"
        return None
    return check


def _stampz(v):
    return None if _utcz(v) else "a UTC Z stamp"


def _counts(v):
    if not isinstance(v, dict) or set(v) != set(COUNT_KEYS):
        return "an object with exactly the keys %s" % ", ".join(COUNT_KEYS)
    for k in COUNT_KEYS:
        if _int(0)(v[k]):
            return "an object with %s an integer >= 0" % k
    return None


def _cadence(v):
    return None if isinstance(v, int) and not isinstance(v, bool) and v in CADENCES else "7 or 14"


def _direction(v):
    return None if isinstance(v, int) and not isinstance(v, bool) and v in (1, -1) else "1 or -1"


# ---- the Time-lost ledger's line (skills/reflect/scripts/ledger.py's model, reflect.py `ledger`; p29-11, ADR 0051) ------
# The schema's one copy of its classes and causes: ledger.py imports them. ADR 0051's six classes, in their ranking's
# tie order; each class's causes keyed by the record's own value where one fits (a stop's cause, a hold, an idle-slots
# reason); the unranked causes are `other`'s.

TIME_LOST_CLASSES = ("stalls", "quota-bound", "load", "lane-bound", "rework", "plan-rejected")
TIME_LOST_CAUSES = {
    "stalls": ("dead-lead", "mac-restart", "mac-sleep", "watchdog", "halt", "gate", "question", "hand-back", "cool-down",
               "hold-git-env", "hold-merge", "hold-race", "hold-trickle", "hold-away-cap", "lead-absent",
               "never-finished", "unexplained"),
    "quota-bound": ("usage-limit", "cool-down"),
    "load": ("hold-heat", "slot-wait", "heat", "timeout"),
    "lane-bound": ("lane",),
    "rework": ("integration", "race"),
    "plan-rejected": ("plan-rejected",),
}
TIME_LOST_OTHER = ("pause", "pause-drain", "dependency", "solo", "queue-tail", "hold-last-start", "hold-pr", "revise")
TIME_LOST_SOURCES = ("record", "audit", "baseline")
AUDIT_SOURCES = ("transcripts", "suite-logs", "pause-logs", "mac-history")
MAX_TL_ROLLOUTS = 8        # contributors kept per class on a time-lost line
# An audit line at its caps (16 entries and 8 gaps, every what, evidence and why at full length in plain ASCII, 64-character
# rollout slugs, a 63-character host) is 14,150 bytes, under MAX_LINE; 24 and 10 were 19,674. Text JSON escapes (a quote,
# a backslash, a non-ASCII character as \uXXXX) can still overflow it: ledger.py's audit_line() measures the line
# (line_bytes) and refuses it in its own words. tests/reflect-ledger.test.mjs pins the maximal line through check().
MAX_AUDIT_ENTRIES = 16
MAX_AUDIT_GAPS = 8
MAX_TL_LIST = 16           # a baseline's ranges and cites
TL_WHAT = 160              # an audit entry's or gap's `what`, a source's `why`, a cite's `what`
TL_EVIDENCE = 200          # an audit entry's or gap's `evidence`
TL_ID_RE = re.compile(r"tl-[A-Za-z0-9._-]+\Z")
MONTH_RE = re.compile(r"\d{4}-(0[1-9]|1[0-2])\Z")


def _tl_id(v):
    return None if isinstance(v, str) and TL_ID_RE.match(v) else "a tl- id (a Time-lost ledger line's)"


def _month(v):
    return None if isinstance(v, str) and MONTH_RE.match(v) else "a YYYY-MM month"


def _hours_num(v):
    return _number(v) and v >= 0


def _six(v):
    """Exactly the six classes, each a finite number >= 0 (hours, recorded)."""
    if not isinstance(v, dict) or set(v) != set(TIME_LOST_CLASSES) or not all(_hours_num(v[k]) for k in v):
        return "an object with exactly the keys %s, each a finite number >= 0" % ", ".join(TIME_LOST_CLASSES)
    return None


def _class_or_null(v):
    return None if v is None or v in TIME_LOST_CLASSES else "one of %s, or null" % ", ".join(TIME_LOST_CLASSES)


def _rank(v):
    ok = isinstance(v, list) and len(v) == len(TIME_LOST_CLASSES) and set(v) == set(TIME_LOST_CLASSES)
    return None if ok else "a list of the six classes, each once"


def _by_cause(v):
    if not isinstance(v, dict) or not set(v) <= set(TIME_LOST_CLASSES):
        return "an object keyed by the classes"
    for cls, causes in v.items():
        if not isinstance(causes, dict):
            return "an object of {cause: hours} per class"
        for cause, h in causes.items():
            if cause not in TIME_LOST_CAUSES[cls]:
                return "an object whose %s causes are among %s (not %r)" % (cls, ", ".join(TIME_LOST_CAUSES[cls]), cause)
            if not _hours_num(h):
                return "an object of hours, each a finite number >= 0"
    return None


def _tl_rollouts(v):
    if not isinstance(v, dict) or not set(v) <= set(TIME_LOST_CLASSES):
        return "an object keyed by the classes"
    for rows in v.values():
        if not isinstance(rows, list) or len(rows) > MAX_TL_ROLLOUTS:
            return "an object of at most %d [slug, hours] per class" % MAX_TL_ROLLOUTS
        for r in rows:
            if not isinstance(r, list) or len(r) != 2 or _slug(r[0]) or not _hours_num(r[1]):
                return "an object of [slug, hours] pairs (a slug, a finite number >= 0)"
    return None


def _other(v):
    ok = isinstance(v, dict) and set(v) <= set(TIME_LOST_OTHER) and all(_hours_num(h) for h in v.values())
    return None if ok else "an object of {cause: hours}, each cause among %s" % ", ".join(TIME_LOST_OTHER)


def _events(v):
    ok = isinstance(v, dict) and all(isinstance(k, str) and k and not _int(0)(n) for k, n in v.items())
    return None if ok else "an object of {name: an integer >= 0}"


def _text(n):
    def check(v):
        return None if isinstance(v, str) and v.strip() and len(v) <= n else "a non-empty string of at most %d characters" % n
    return check


def _audit(v):
    """An audit line's {sources, entries, gaps} (the catalogue's time-lost entry)."""
    if not isinstance(v, dict) or set(v) != {"sources", "entries", "gaps"}:
        return "an object of exactly sources, entries and gaps"
    src = v["sources"]
    if not isinstance(src, list) or not 1 <= len(src) <= 8:
        return "an object whose sources is a list of 1 to 8"
    for s in src:
        if not isinstance(s, dict) or not {"source", "read"} <= set(s) or set(s) - {"source", "read", "why"}:
            return "an object whose sources are {source, read, why?}"
        if s["source"] not in AUDIT_SOURCES or _bool(s["read"]) or ("why" in s and _text(TL_WHAT)(s["why"])):
            return "an object whose sources name one of %s, read a bool, why a short string" % ", ".join(AUDIT_SOURCES)
    if len({s["source"] for s in src}) != len(src):
        return "an object whose sources are distinct"
    ent = v["entries"]
    if not isinstance(ent, list) or len(ent) > MAX_AUDIT_ENTRIES:
        return "an object whose entries is a list of at most %d" % MAX_AUDIT_ENTRIES
    keys = {"class", "cause", "rollout", "from", "to", "hours", "what", "evidence"}
    for e in ent:
        if not isinstance(e, dict) or set(e) != keys:
            return "an object whose entries are {%s}" % ", ".join(sorted(keys))
        if e["class"] not in TIME_LOST_CLASSES or e["cause"] not in TIME_LOST_CAUSES[e["class"]]:
            return "an object whose entries name a class and one of its causes"
        if _slug(e["rollout"]) or not _utcz(e["from"]) or not _utcz(e["to"]) or not _hours_num(e["hours"]):
            return "an object whose entries carry a rollout slug, UTC Z from and to, and hours"
        if _text(TL_WHAT)(e["what"]) or _text(TL_EVIDENCE)(e["evidence"]):
            return "an object whose entries' what is at most %d characters and evidence at most %d" % (TL_WHAT, TL_EVIDENCE)
    gaps = v["gaps"]
    if not isinstance(gaps, list) or len(gaps) > MAX_AUDIT_GAPS:
        return "an object whose gaps is a list of at most %d" % MAX_AUDIT_GAPS
    for g in gaps:
        if not isinstance(g, dict) or set(g) != {"what", "evidence"} or _text(TL_WHAT)(g["what"]) or \
                _text(TL_EVIDENCE)(g["evidence"]):
            return "an object whose gaps are {what, evidence} (at most %d and %d characters)" % (TL_WHAT, TL_EVIDENCE)
    return None


def _objects(v):
    ok = isinstance(v, list) and len(v) <= MAX_TL_LIST and all(isinstance(x, dict) and x for x in v)
    return None if ok else "a list of at most %d non-empty objects" % MAX_TL_LIST


def _check_time_lost(f):
    """time-lost's cross-field rules (the catalogue's entry): what each source carries, and since <= until."""
    src = f["source"]
    if _z_time(f["since"]) > _z_time(f["until"]):
        raise Refused("time-lost: since %s is after until %s" % (f["since"], f["until"]))
    need = {"record": ("reflection", "hours"), "audit": ("reflection", "month", "hours", "audit"),
            "baseline": ("month",)}[src]
    missing = [k for k in need if k not in f]
    if missing:
        raise Refused("time-lost: %s %s line needs %s" % ("an" if src == "audit" else "a", src, ", ".join(missing)))
    only = {"recorded": "audit", "rank": "audit", "audit": "audit", "top": "record", "streak": "record",
            "ranges": "baseline", "cites": "baseline"}
    wrong = sorted(k for k, s in only.items() if k in f and s != src)
    if wrong:
        raise Refused("time-lost: %s %s not on %s %s line" % (", ".join(wrong), "is" if len(wrong) == 1 else "are",
                                                             "an" if src == "audit" else "a", src))
    if src == "baseline" and "hours" in f:
        raise Refused("time-lost: hours is a record or an audit line's (a baseline carries ranges and cites)")


# ---- the Grade log's kind (skills/_shared/scripts/estate-dispatch.py log; p25-4, ADR 0041) -------------------------
# estate-rank.py's GRADES, SHAPES, SIZE_MINUTES keys and GATE_KINDS, copied (this module stays at python 3.8 and loads
# no sibling); tests/contracts/readiness-grade.test.mjs c9 pins the two copies together.

GRADE_NAMES = ("Ready", "One call", "Grill", "Orient")
GRADE_SHAPES = ("parallel", "serial", "session")
GRADE_SIZES = ("S", "M", "L")
GRADE_GATES = ("spend", "credential", "irreversible")
RAISE_WHYS = ("decisions", "confidence")   # estate-rank.py's raised[] whys
GRADE_PASS_RE = re.compile(r"g-[A-Za-z0-9._-]+\Z")
GRADE_DIGEST_RE = re.compile(r"[0-9a-f]{12}\Z")


def _distinct_of(values, empty):
    def check(v):
        ok = isinstance(v, list) and (empty or v) and all(isinstance(x, str) and x in values for x in v) \
            and len(set(v)) == len(v)
        return None if ok else "a list of distinct %s from %s" % ("values" if empty else "values, at least one",
                                                                   ", ".join(values))
    return check


def _match(regex, what):
    def check(v):
        return None if isinstance(v, str) and regex.match(v) else what
    return check


def _slug(v):
    ok = isinstance(v, str) and SLUG_RE.fullmatch(v) and v not in RESERVED
    return None if ok else "a slug ([a-z0-9][a-z0-9._-]*), not reserved"


# ---- the Inert-path kinds (skills/execute/scripts/lead-integrate.py prepare; p29-3, ADR 0045) ----------------------

READER_KINDS = ("name", "walk", "link", "tool", "symlink", "unprovable", "submodule")
READER_ORIGINS = ("repo", "cwd", "path", "input", "open", "depth")
READER_KEYS = ("glob", "path", "kind")
READER_OPTIONAL = ("line", "text", "origin")
MAX_READERS = 20
MAX_PATHS = 200
MAX_GLOBS = 64
READER_TEXT = 120
ERROR_MAX = 200


def _readers(v):
    if not isinstance(v, list) or len(v) > MAX_READERS:
        return "a list of at most %d readers" % MAX_READERS
    for r in v:
        if not isinstance(r, dict) or not set(READER_KEYS) <= set(r) or set(r) - set(READER_KEYS + READER_OPTIONAL):
            return "a list of objects with glob, path and kind (and line?, text?, origin? only)"
        if _str(r["glob"]) or _str(r["path"]):
            return "a list whose glob and path are non-empty strings"
        if r["kind"] not in READER_KINDS:
            return "a list whose kind is one of %s" % ", ".join(READER_KINDS)
        if "line" in r and _int(0)(r["line"]):
            return "a list whose line is an integer >= 0"
        if "text" in r and (not isinstance(r["text"], str) or len(r["text"]) > READER_TEXT):
            return "a list whose text is a string of at most %d characters" % READER_TEXT
        if "origin" in r and r["origin"] not in READER_ORIGINS:
            return "a list whose origin is one of %s" % ", ".join(READER_ORIGINS)
    return None


def _capped(n):
    def check(v):
        ok = isinstance(v, list) and len(v) <= n and all(isinstance(x, str) and x for x in v)
        return None if ok else "a list of at most %d non-empty strings" % n
    return check


def _error(v):
    return None if isinstance(v, str) and v.strip() and len(v) <= ERROR_MAX else \
        "a non-empty string of at most %d characters" % ERROR_MAX


INERT_FIELDS = {"repo": _str, "paths": _capped(MAX_PATHS), "pathsTotal": _int(0)}
INERT_OPTIONAL = {"base": _str, "main": _str, "head": _str, "globs": _capped(MAX_GLOBS)}

# ---- the time-lost ledger's kinds (p29-10, ADR 0051) ------------------------------------------------------------
# stopped and lead-entry (reconcile-rollout.py record-entry and next, step-boundary.py begin, the Stop-hook driver),
# suite-started and suite-ended (verify-slot.py run, lead-integrate.py verify), base-moved (lead-integrate.py base-moved).

STOP_CAUSES = ("usage-limit", "dead-lead", "mac-restart", "mac-sleep", "halt", "watchdog")
ENTRY_BYS = ("lachy", "stage", "watchdog", "heartbeat", "repair")
ENTRY_STOPS = ("usage-limit", "dead-lead", "mac-restart", "halt", "watchdog", "pause")
CALL_KINDS = ("task", "revise", "integrate", "resume")      # run-bound's `call`
SUITE_BYS = ("task", "integration", "race", "completion")
SUITE_RUNNERS = ("agent", "lead")
SUITE_OUTCOMES = ("green", "red", "timeout", "stopped", "unrun", "noslot", "heat")
SUITE_STEPS = ("env_bootstrap", "verifier")
MOVER_KINDS = ("rollout", "peer")
MOVER_SOURCES = ("record", "note")
MAX_CALLS = 64
MAX_FAILING = 50
FAILING_NAME = 200
MAX_MOVERS = 20
MAX_NON_INERT = 20
REASON_MAX = 200
SUITE_ID_RE = re.compile(r"s-[0-9a-f]{16}\Z")
HEX12_RE = re.compile(r"[0-9a-f]{12}\Z")


def _calls(v):
    """stopped's calls: at most MAX_CALLS {task, runId?, call?}."""
    if not isinstance(v, list) or len(v) > MAX_CALLS:
        return "a list of at most %d calls" % MAX_CALLS
    for c in v:
        if not isinstance(c, dict) or "task" not in c or set(c) - {"task", "runId", "call"}:
            return "a list of objects with task (and runId?, call? only)"
        if _str(c["task"]) or ("runId" in c and _str(c["runId"])):
            return "a list whose task and runId are non-empty strings"
        if "call" in c and c["call"] not in CALL_KINDS:
            return "a list whose call is one of %s" % ", ".join(CALL_KINDS)
    return None


def _load3(v):
    """A load average: exactly 3 finite numbers >= 0."""
    ok = isinstance(v, list) and len(v) == 3 and all(_number(x) and x >= 0 for x in v)
    return None if ok else "exactly 3 finite numbers >= 0"


def _seconds(v):
    return None if _number(v) and v >= 0 else "a finite number of seconds >= 0"


def _suite_id(v):
    return None if isinstance(v, str) and SUITE_ID_RE.match(v) else "s- and 16 lowercase hex"


def _hex12(v):
    return None if isinstance(v, str) and HEX12_RE.match(v) else "12 lowercase hex"


def _names(n, width):
    def check(v):
        ok = isinstance(v, list) and len(v) <= n and all(isinstance(x, str) and x and len(x) <= width for x in v)
        return None if ok else "a list of at most %d non-empty strings of at most %d characters" % (n, width)
    return check


def _movers(v):
    """base-moved's movers: at most MAX_MOVERS {sha, kind, rollout?, task?, pr?, source?}."""
    if not isinstance(v, list) or len(v) > MAX_MOVERS:
        return "a list of at most %d movers" % MAX_MOVERS
    for m in v:
        if not isinstance(m, dict) or not {"sha", "kind"} <= set(m) or \
                set(m) - {"sha", "kind", "rollout", "task", "pr", "source"}:
            return "a list of objects with sha and kind (and rollout?, task?, pr?, source? only)"
        if _str(m["sha"]) or m["kind"] not in MOVER_KINDS:
            return "a list whose sha is a non-empty string and kind one of %s" % ", ".join(MOVER_KINDS)
        if any(k in m and _str(m[k]) for k in ("rollout", "task")):
            return "a list whose rollout and task are non-empty strings"
        if "pr" in m and _pr(m["pr"]):
            return "a list whose pr is a url or a number"
        if "source" in m and m["source"] not in MOVER_SOURCES:
            return "a list whose source is one of %s" % ", ".join(MOVER_SOURCES)
    return None


def _bool_or_null(v):
    return None if v is None or isinstance(v, bool) else "true, false or null"


def _z_time(v):
    """A UTC Z stamp (UTC_Z_RE) as an aware datetime, for the cross-field order checks."""
    s = v[:-1]
    if "." in s:
        head, frac = s.split(".", 1)
        s = "%s.%s" % (head, frac.ljust(6, "0"))
    return datetime.datetime.fromisoformat(s + "+00:00")


def _check_stopped(f):
    """stopped's cross-field rules: boot only on mac-restart; wake on mac-sleep and only there, never before at; an
    inferred stop carries at (its start in the past; its ts is its write time)."""
    cause = f["cause"]
    if "boot" in f and cause != "mac-restart":
        raise Refused("stopped: boot is a mac-restart's field")
    if (cause == "mac-sleep") != ("wake" in f):
        raise Refused("stopped: wake is required on a mac-sleep and only there")
    if f["inferred"] and "at" not in f:
        raise Refused("stopped: an inferred stop carries at (its start)")
    if "wake" in f and "at" in f and _z_time(f["at"]) > _z_time(f["wake"]):
        raise Refused("stopped: at %s is after wake %s" % (f["at"], f["wake"]))


SUITE_REQUIRED = {"suite": _suite_id, "by": _enum(*SUITE_BYS), "runner": _enum(*SUITE_RUNNERS)}

HOLDS = ("merge", "git-env", "race")
# p29-12: reconcile-rollout.py's call-end stamp on the events of a row that ends a Slot (Reading the record).
CALL_END = {"stamp": _enum("call-end", "fallback"), "reconciledAt": _stampz}
# kind -> (task required, required fields, optional fields)
KINDS = {
    "slot-taken": (True, {"settings": SETTINGS},
                   {"start": _enum("start", "restart", "revise", "hand-back", "resume"), "carriedFrom": _str,
                    "cap": _cap}),
    "run-bound": (True, {"runId": _str, "journalDir": _str},
                  {"call": _enum("task", "revise", "integrate", "resume"), "resumedFrom": _str}),
    "slot-freed": (True, {"outcome": _enum("ready", "set-aside", "completed", "lost", "stopped", "failed")},
                   {**CALL_END}),
    "ready": (True, {}, {"pr": _pr, **CALL_END}),
    "set-aside": (True, {"stage": _enum("plan", "implement", "verify", "review", "integrate", "gate"),
                         "reasonClass": _str}, {"setAsideAt": _enum("run", "integration", "gate"), **CALL_END}),
    "lane-taken": (True, {}, {}),
    "lane-freed": (True, {"release": _enum("merge", "set-aside", "reject", "halt")},
                   {"path": _str, "triggers": _strlist, "conflict": _bool}),
    "merged": (True, {}, {"pr": _pr, "readOnly": _bool, **CALL_END}),
    "paused": (False, {"mode": _enum("soft", "hard", "sign-off")}, {}),
    "resumed": (False, {}, {}),
    "hold-started": (False, {"hold": _enum(*HOLDS)}, {}),
    "hold-ended": (False, {"hold": _enum(*HOLDS)}, {}),
    "idle-slots": (False, {"reason": _enum("dependency", "solo", "pause-drain", "queue-tail", "awaiting-hand-back",
                                           "hold-merge", "hold-git-env", "hold-race", "hold-pr", "hold-heat", "hold-trickle",
                                           "hold-away-cap", "hold-last-start"),
                           "free": _int(0), "settings": SETTINGS}, {}),
    # The night record (p28-2, Chorus ADR 0104's Consequences): reconcile-rollout.py `next` is its one writer.
    "away-night": (False, {"morning": _stampz}, {}),
    "last-start-held": (True, {"morning": _stampz, "scope": _str, "history": _int(0)}, {"usualMinutes": _int(1)}),
    "ran-past-morning": (True, {"morning": _stampz, "slotTakenAt": _stampz, "scope": _str, "history": _int(0)},
                         {"usualMinutes": _int(1)}),
    "quota-stall": (False, {}, {"stage": _str, "detail": _str, "runId": _str, "call": _enum(*CALL_KINDS),
                                **CALL_END}),
    "auto-retry": (True, {"stage": _enum("plan", "implement", "verify", "review", "integrate"),
                          "setAsideAt": _enum("run", "integration"), "retryClass": _enum("agent", "infra", "quota"),
                          "used": _int(0), "budget": _int(1)},
                   {"fingerprint": _str, "reviewRounds": _int(1), "quotaRetries": _int(1)}),
    "verify-skipped": (True, dict(INERT_FIELDS), dict(INERT_OPTIONAL)),
    "inert-proof-failed": (True, dict(INERT_FIELDS, readers=_readers),
                           dict(INERT_OPTIONAL, error=_error, failed=_capped(MAX_GLOBS))),
    # result: reconcile-rollout.py's COMPLETION_RESULTS, in its order.
    "completion-verify": (False, {"result": _enum("green", "flake", "red", "rerun", "noslot", "unrun", "stopped",
                                                  "heat"),
                                  "rc": _str, "sha": _str, "attempt": _int(1, 2)}, {"log": _str, "followup": _str}),
    # p29-9 (ADR 0050, ADR 0051): reconcile-rollout.py's _record_flakes and record-verify.
    "flake": (True, {"test": _str, "repo": _str, "sha": _str, "site": _enum("task", "integrate", "integration", "race")},
              {"followup": _str, "count": _int(1)}),
    "suite-timeout": (True, {"site": _enum("integration", "race"), "run": _enum("first", "named", "confirm"),
                             "seconds": _int(1)}, {"sha": _str}),
    "call-journal": (False, {"runId": _str, "status": _str},
                     {"mode": _str, "tokens": _int(0), "durationMs": _int(0), "agents": _int(0),
                      "startTime": _int(0)}),
    "review-round": (False, {"repo": _str, "head": _str, "digest": _str},
                     {"doc": _str, "mode": _str, "effort": _str, "findings": _int(0), "original": _int(0),
                      "regression": _int(0), "verdict": _str}),
    "review-verdict": (True, {"round": _int(1), "verdict": _enum("approve", "changes"), "findings": _int(0),
                              "original": _int(0), "regression": _int(0), "digest": _str},
                       {"head": _str, **CALL_END}),
    "carried": (True, {"from": _str, "to": _str}, {}),
    "answer-recorded": (True, {"answerKind": _enum("needs-you", "decision")},
                        {"form": _enum("hand-back", "awaiting-repair", "left"),
                         "raise": _enum("max_review_rounds", "max_plan_rounds", "max_iterations"), "pr": _bool}),
    "gate-signed": (True, {"standing": _bool, "gates": _int(1)}, {}),
    "handed-back": (True, {"via": _enum("answer", "descope", "retry"), "arm": _enum("run", "integration")}, {}),
    "race-decided": (True, {"mark": _enum("RACE", "UNVERIFIED"), "by": _enum("resume", "hand-back", "auto-retry")}, {}),
    "tuning": (False, {"id": _str, "repo": _repo, "window": _window, "scores": _scores, "applied": _applied},
               {"binding": _enum(*BINDINGS), "voids": _str, "close": _enum(*CLOSES), "auto": _true,
                "reflection": _rid, "reverts": _tid, "shape": _enum("serial")}),
    "watch": (False, {"id": _str, "rule": _short(RULE_MAX), "shape": _short(RULE_MAX),
                      "rollouts": _slugs(1, MAX_ROLLOUTS), "count": _int(1), "reflection": _rid},
              {"ledgerClass": _enum(*TIME_LOST_CLASSES)}),
    "watch-raised": (False, {"id": _str, "reflection": _rid, "via": _enum(*VIAS)}, {}),
    "proposal": (False, {"id": _str, "altitude": _enum(*ALTITUDES), "reflection": _rid,
                         "rollouts": _slugs(1, MAX_ROLLOUTS)},
                 {"repo": _str, "key": _enum(*TUNING_KEYS), "rule": _str, "shape": _short(RULE_MAX),
                  "direction": _direction, "from": _int(1), "to": _int(1), "ranAt": _int(1), "landed": _bool,
                  "auto": _true, "tuning": _tid, "reverts": _tid, "held": _short(300), "vaultTask": _str,
                  "filed": _bool, "fixes": _str}),
    "grade": (True, {"pass": _match(GRADE_PASS_RE, "a g- id (an estate pass's)"),
                     "digest": _match(GRADE_DIGEST_RE, "12 lowercase hex"), "project": _str,
                     "grade": _enum(*GRADE_NAMES), "agentGrade": _enum(*GRADE_NAMES), "shape": _enum(*GRADE_SHAPES),
                     "size": _enum(*GRADE_SIZES), "decisions": _int(0), "low": _int(0), "held": _bool,
                     "gates": _distinct_of(GRADE_GATES, True)},
              {"raised": _distinct_of(RAISE_WHYS, False), "rank": _int(1), "linked": _slug}),
    "reflection": (False, {"id": _rid, "since": _stampz, "until": _stampz, "rollouts": _slugs(0, 4096),
                           "escapesOnly": _slugs(0, 4096), "counts": _counts, "quiet": _bool},
                   {"decisionTask": _str, "cadence": _cadence, "repairsOnly": _slugs(1, 4096)}),
    # The Time-lost ledger's own line (p29-11, ADR 0051): one per (Reflection, source), reflect.py `ledger` its writer.
    "time-lost": (False, {"id": _tl_id, "source": _enum(*TIME_LOST_SOURCES), "since": _stampz, "until": _stampz},
                  {"month": _month, "reflection": _rid, "hours": _six, "recorded": _six, "rank": _rank,
                   "top": _class_or_null, "byCause": _by_cause, "rollouts": _tl_rollouts, "other": _other,
                   "events": _events, "streak": _int(0), "audit": _audit, "ranges": _objects, "cites": _objects}),
    # The time-lost ledger (p29-10, ADR 0051): stops and resumes, suites with the load around them, why main moved.
    "stopped": (False, {"cause": _enum(*STOP_CAUSES), "inferred": _bool, "calls": _calls},
                {"at": _stampz, "boot": _stampz, "wake": _stampz, "reason": _short(REASON_MAX)}),
    "lead-entry": (False, {"by": _enum(*ENTRY_BYS)}, {"session": _str, "stop": _enum(*ENTRY_STOPS)}),
    "suite-started": (False, dict(SUITE_REQUIRED, sha=_str, dirty=_bool),
                      {"load": _load3, "diff": _hex12, "waited": _seconds, "running": _int(0)}),
    "suite-ended": (False, dict(SUITE_REQUIRED, outcome=_enum(*SUITE_OUTCOMES), seconds=_seconds),
                    {"load": _load3, "rc": _int(0, 255), "failing": _names(MAX_FAILING, FAILING_NAME),
                     "timeout": _seconds, "step": _enum(*SUITE_STEPS), "sha": _str, "waited": _seconds,
                     "running": _int(0)}),
    "base-moved": (True, {"repo": _str, "pr": _pr, "base": _str, "main": _str, "inertOnly": _bool_or_null,
                          "moversTotal": _int(0), "movers": _movers},
                   {"nonInert": _capped(MAX_NON_INERT), "pathsTotal": _int(0), "globs": _capped(MAX_GLOBS),
                    "refusal": _int(1), "error": _error}),
}


# ---- small pieces ----------------------------------------------------------------------------------------

def _say(line):
    try:
        sys.stderr.write("run_record: %s\n" % line)
        sys.stderr.flush()
    except Exception:
        pass


def normalise_slug(value, what="slug"):
    """A bare slug, [[slug]], [[slug|alias]], [[dir/slug]] or a note path ending .md -> the lowercased slug."""
    if not isinstance(value, str):
        raise Refused("%s must be a string" % what)
    s = value.strip()
    m = LINK_RE.fullmatch(s)
    if m:
        s = m.group(1).strip().rsplit("/", 1)[-1]
        if s.endswith(".md"):
            s = s[:-3]
    elif s.endswith(".md"):
        s = re.split(r"[\\/]", s)[-1][:-3]
    s = s.lower()
    if not SLUG_RE.fullmatch(s):
        raise Refused("%s %r is not a slug ([a-z0-9][a-z0-9._-]*)" % (what, value))
    return s


def _home(env):
    h = env.get("HOME")
    if h:
        return h
    try:  # HOME unset: the passwd entry, as expanduser does
        import pwd
        return pwd.getpwuid(os.getuid()).pw_dir
    except Exception:
        return os.path.expanduser("~")


def events_dir(env=None):
    """The resolved events directory (pure: reads only `env`, default os.environ). ValueError when unresolvable."""
    env = os.environ if env is None else env
    over = env.get("THREAD_EVENTS_DIR")
    if over:
        if over == "~" or over.startswith("~/"):
            over = _home(env) + over[1:]
        elif over.startswith("~"):
            over = os.path.expanduser(over)
        if not os.path.isabs(over):
            raise ValueError("THREAD_EVENTS_DIR is relative (%s); it must be absolute" % over)
        return os.path.normpath(over)
    xdg = env.get("XDG_STATE_HOME")
    base = xdg if xdg and os.path.isabs(xdg) else os.path.join(_home(env), ".local", "state")
    return os.path.normpath(os.path.join(base, "thread", "events"))


def record_path(rollout, env=None):
    """The file a rollout's events go to (pure). `rollout` None means reviews.jsonl."""
    name = REVIEWS if rollout is None else normalise_slug(rollout, "rollout")
    return os.path.join(events_dir(env), name + ".jsonl")


def _stamp(ts):
    if ts is None:
        t = datetime.datetime.now(datetime.timezone.utc)
    else:
        if not isinstance(ts, str):
            raise Refused("ts must be a string")
        m = STAMP_RE.fullmatch(ts.strip())
        if not m:
            raise Refused("ts %r is not an ISO 8601 stamp (YYYY-MM-DDTHH:MM[:SS[.fff]] with Z or an offset)" % ts)
        date, hm, sec, frac, zulu, sign, oh, om = m.groups()
        if not zulu and not sign:
            raise Refused("ts %r has no offset or Z" % ts)
        offset = "+00:00" if zulu else "%s%s:%s" % (sign, oh, om or "00")
        canon = "%sT%s:%s.%s%s" % (date, hm, sec or "00", (frac or "")[:6].ljust(6, "0"), offset)
        try:  # the canonical form parses the same on 3.8 and 3.11+
            t = datetime.datetime.fromisoformat(canon)
        except ValueError as e:
            raise Refused("ts %r is not a valid time: %s" % (ts, e))
        t = t.astimezone(datetime.timezone.utc)
    return t.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (t.microsecond // 1000)


def _host():
    try:
        return socket.gethostname().split(".")[0] or "unknown"
    except Exception:
        return "unknown"


def _check_fields(kind, fields):
    _, required, optional = KINDS[kind]
    for k in COMMON:
        if k in fields:
            raise Refused("%s: field %r collides with a common key" % (kind, k))
    for k, check in required.items():
        if k not in fields:
            raise Refused("%s: missing required field %r" % (kind, k))
        why = check(fields[k])
        if why:
            raise Refused("%s: %s must be %s" % (kind, k, why))
    for k, check in optional.items():
        if k in fields:
            why = check(fields[k])
            if why:
                raise Refused("%s: %s must be %s" % (kind, k, why))
    if kind == "review-verdict" and fields["original"] + fields["regression"] > fields["findings"]:
        raise Refused("review-verdict: original + regression (%d + %d) exceed findings (%d)"
                      % (fields["original"], fields["regression"], fields["findings"]))
    if kind == "tuning":
        _check_tuning(fields)
    elif kind == "watch":
        if fields["rule"] != fields["rule"].strip() or fields["shape"] != fields["shape"].strip():
            raise Refused("watch: rule and shape are stored stripped")
        if fields["id"] != watch_id(fields["rule"], fields["shape"]):
            raise Refused("watch: id %r is not watch_id(rule, shape) %r" % (fields["id"], watch_id(fields["rule"], fields["shape"])))
    elif kind == "proposal":
        _check_proposal(fields)
    elif kind == "grade" and fields["low"] > fields["decisions"]:
        raise Refused("grade: low (%d) exceeds decisions (%d)" % (fields["low"], fields["decisions"]))
    elif kind == "inert-proof-failed" and not fields["readers"] and "error" not in fields:
        raise Refused("inert-proof-failed: readers is empty only beside an error (a failed proof names its reader)")
    elif kind == "stopped":
        _check_stopped(fields)
    elif kind == "suite-ended":
        if "timeout" in fields and fields["outcome"] != "timeout":
            raise Refused("suite-ended: timeout is only on outcome timeout")
        if "rc" in fields and fields["outcome"] in ("noslot", "heat"):
            raise Refused("suite-ended: a %s suite has no verdict, so it has no rc" % fields["outcome"])
    elif kind == "base-moved" and fields["inertOnly"] is None and "error" not in fields:
        raise Refused("base-moved: inertOnly is null only beside an error (the inert test could not run)")
    elif kind == "time-lost":
        _check_time_lost(fields)


def _check_tuning(f):
    """The serial rule (the Files' Serial bullet): repo is a string unless `shape: serial`, and then null; a serial line
    is a close line with applied [] and no binding, voids, auto, reflection or reverts; quotaStalls is null only there.
    Then the auto rules (the Files' Auto bullet): auto <=> reflection; reverts => auto with one entry; agreed only on an
    auto line without reverts, and on every entry of a non-void auto landing; never auto and close on one line."""
    if f.get("shape") == "serial":
        if f["repo"] is not None:
            raise Refused("tuning: a serial line's repo is null (a chain has no one repo)")
        if f["applied"] or "close" not in f:
            raise Refused("tuning: a serial line is a close line: applied [] and a close")
        extra = [k for k in ("binding", "voids", "auto", "reflection", "reverts") if k in f]
        if extra:
            raise Refused("tuning: a serial line carries no %s" % ", ".join(extra))
    else:
        if f["repo"] is None:
            raise Refused("tuning: repo must be a non-empty string (null only on a serial line)")
        if f["scores"]["quotaStalls"] is None:
            raise Refused("tuning: scores must be an object with quotaStalls an integer >= 0 (null only on a serial line)")
    auto = f.get("auto") is True
    if auto != ("reflection" in f):
        raise Refused("tuning: auto and reflection go together (the weekly reading's landing carries both)")
    if "reverts" in f and (not auto or len(f["applied"]) != 1):
        raise Refused("tuning: reverts needs auto and exactly one applied entry")
    if auto and "close" in f:
        raise Refused("tuning: a line is never both auto and a close line")
    has_agreed = [e for e in f["applied"] if "agreed" in e]
    if has_agreed and (not auto or "reverts" in f):
        raise Refused("tuning: agreed is only on an auto landing's entries (never a pick, a record-only or a revert)")
    if auto and "reverts" not in f and "voids" not in f and len(has_agreed) != len(f["applied"]):
        raise Refused("tuning: every entry of an auto landing carries agreed")


def _check_proposal(f):
    """Each altitude's fields (the catalogue's proposal entry)."""
    alt = f["altitude"]
    need = {"knob": ("repo", "key", "rule", "direction", "from", "to", "ranAt", "landed"),
            "rule": ("rule", "shape", "vaultTask"),
            "bug": ("rule", "shape", "vaultTask", "filed")}[alt]
    missing = [k for k in need if k not in f]
    if missing:
        raise Refused("proposal: a %s proposal needs %s" % (alt, ", ".join(missing)))
    if "landed" in f and alt != "knob":
        raise Refused("proposal: landed is a knob's field")
    if "filed" in f and alt != "bug":
        raise Refused("proposal: filed is a bug's field")
    if alt == "knob":
        if len(f["rule"]) > 64:
            raise Refused("proposal: a knob's rule is at most 64 characters")
        want = knob_key(f["repo"], f["key"], f["rule"], f["direction"])
        if f["id"] != want:
            raise Refused("proposal: id %r is not knob_key(repo, key, rule, direction) %r" % (f["id"], want))
    else:
        if len(f["rule"]) > RULE_MAX or f["rule"] != f["rule"].strip() or f["shape"] != f["shape"].strip():
            raise Refused("proposal: a %s's rule and shape are stored stripped, at most %d characters" % (alt, RULE_MAX))
        want = watch_id(f["rule"], f["shape"])
        if f["id"] != want:
            raise Refused("proposal: id %r is not watch_id(rule, shape) %r" % (f["id"], want))
    if "auto" in f and not ((alt == "knob" and f.get("landed") is True) or (alt == "bug" and f.get("filed") is True)):
        raise Refused("proposal: auto is only on a landed knob or a filed bug")
    if "held" in f and not (alt == "knob" and f.get("landed") is False):
        raise Refused("proposal: held is only on an unlanded knob")


# ---- review-verdict's identity (p21-3) -------------------------------------------------------------------
# One definition for the writer (reconcile-rollout.py skips an entry whose key the record already holds) and the
# reader (score.py keeps the first line per key), so a replayed round is written, and counted, once.

def verdict_digest(verdict, feedback):
    """The first 16 lowercase hex of sha256 over the compact ASCII JSON of [verdict, feedback]."""
    text = json.dumps([verdict, feedback], ensure_ascii=True, separators=(",", ":"))
    return hashlib.sha256(text.encode("ascii")).hexdigest()[:16]


def verdict_key(line):
    """A review-verdict line's identity: (task, round, "head", head) when it carries a non-empty head, else
    (task, round, "digest", digest). `line` is a dict with task, round, head? and digest."""
    head = line.get("head")
    if isinstance(head, str) and head:
        return (line.get("task"), line.get("round"), "head", head)
    return (line.get("task"), line.get("round"), "digest", line.get("digest"))


def _encode(ts, host, rollout, task, kind, fields):
    obj = {"v": KIND_VERSIONS.get(kind, VERSION), "ts": ts, "host": host, "rollout": rollout, "task": task, "kind": kind}
    obj.update(fields)
    try:
        text = json.dumps(obj, ensure_ascii=True, allow_nan=False, separators=(",", ":"))
    except ValueError as e:
        raise Refused("%s: %s" % (kind, e))
    except TypeError as e:
        raise Refused("%s: a field is not JSON: %s" % (kind, e))
    return (text + "\n").encode("ascii")


def _line(ts, host, rollout, task, kind, fields):
    data = _encode(ts, host, rollout, task, kind, fields)
    if len(data) > MAX_LINE:
        raise Refused("%s: the line is %d bytes, over the %d-byte limit" % (kind, len(data), MAX_LINE))
    return data


def line_bytes(kind, fields, rollout=None, task=None):
    """The bytes emit would write for `fields` now, on this host, its newline included, whether or not they pass MAX_LINE
    (no field is checked; Refused only for a field that is no JSON). Every stamp is the same length, so the size holds at
    any later emit on this host."""
    return len(_encode(_stamp(None), _host(), rollout, task, kind, dict(fields or {})))


# ---- writing ---------------------------------------------------------------------------------------------

def _write_all(fd, data):
    n = os.write(fd, data)
    if n != len(data):
        raise OSError("short write (%d of %d bytes)" % (n, len(data)))


def _append(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
    try:
        _write_all(fd, data)
    finally:
        os.close(fd)
    return True


def _same_fold(a, b):
    drop = ("ts", "host")
    return {k: v for k, v in a.items() if k not in drop} == {k: v for k, v in b.items() if k not in drop}


def _fold_skips(path, new):
    """True when the call-journal line `new` adds nothing: its runId has a terminal line, or it equals the latest."""
    latest = None
    try:
        with open(path, "rb") as f:
            for raw in f:
                try:
                    d = json.loads(raw)
                except ValueError:
                    continue
                if not isinstance(d, dict) or d.get("kind") != "call-journal" or d.get("runId") != new["runId"]:
                    continue
                if d.get("status") in TERMINAL_STATUSES:
                    return True
                latest = d
    except FileNotFoundError:
        return False
    return latest is not None and _same_fold(latest, new)


def _fold(path, data, new):
    """Append a call-journal line under an exclusive flock, unless _fold_skips. Returns True (written or skipped)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd = os.open(path, os.O_RDWR | os.O_APPEND | os.O_CREAT, 0o644)
    try:
        if fcntl is None:
            _say("warning: no file locking here; the call-journal fold for %s scans %s unlocked" % (new["runId"], path))
        else:
            deadline = time.monotonic() + LOCK_WAIT
            while True:
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except (BlockingIOError, PermissionError):
                    if time.monotonic() >= deadline:
                        raise OSError("the lock stayed busy for %d s" % LOCK_WAIT)
                    time.sleep(0.02)
        if not _fold_skips(path, new):
            _write_all(fd, data)
    finally:
        os.close(fd)  # releases the flock
    return True


def _write(path, data, new, kind):
    try:
        if kind == "call-journal":
            return _fold(path, data, new)
        return _append(path, data)
    except Exception as e:
        _say("warning: cannot write %s: %s" % (path, e))
        return False


# ---- emit ------------------------------------------------------------------------------------------------

def _prepare(rollout, kind, task, fields, ts):
    """Every refusal emit makes, in its order: [(file name, line bytes)] to append, or Refused. Writes nothing."""
    if not isinstance(kind, str) or kind not in KINDS:
        raise Refused("unknown kind %r (known: %s)" % (kind, ", ".join(sorted(KINDS))))
    if fields is None:
        fields = {}
    if not isinstance(fields, dict):
        raise Refused("%s: fields must be a JSON object" % kind)
    fields = dict(fields)
    task_required = KINDS[kind][0]
    if kind == "review-round":
        if rollout is not None or task is not None:
            raise Refused("review-round has no rollout or task (it lands in reviews.jsonl)")
    elif kind in REFLECTION_KINDS:
        if rollout is not None or task is not None:
            raise Refused("%s has no rollout or task (it lands in %s.jsonl)" % (kind, REFLECTIONS))
    elif kind == "grade":
        if rollout is not None:
            raise Refused("grade has no rollout (it lands in %s.jsonl)" % GRADE_LOG)
    else:
        if rollout is None:
            raise Refused("%s: a rollout is required" % kind)
        rollout = normalise_slug(rollout, "rollout")
        if rollout in RESERVED:
            raise Refused("rollout %r is reserved (%s.jsonl is no rollout's record)" % (rollout, rollout))
    if kind == "tuning" and task is not None:
        raise Refused("tuning has no task (it lands in %s.jsonl)" % TUNINGS)
    if task is not None:
        task = normalise_slug(task, "task")
    elif task_required:
        raise Refused("%s: a task is required" % kind)
    if kind == "slot-taken" and "carriedFrom" in fields:
        fields["carriedFrom"] = normalise_slug(fields["carriedFrom"], "carriedFrom")
    targets = [rollout]
    if kind == "carried":
        if "from" not in fields:
            raise Refused("carried: missing required field 'from'")
        old = normalise_slug(fields["from"], "from")
        if old in RESERVED:
            raise Refused("from %r is reserved (%s.jsonl is no rollout's record)" % (old, old))
        if "to" in fields and normalise_slug(fields["to"], "to") != rollout:
            raise Refused("carried: to %r is not the rollout %r" % (fields["to"], rollout))
        if old == rollout:
            raise Refused("carried: from and to are the same rollout %r" % rollout)
        fields["from"], fields["to"] = old, rollout
        targets = [old, rollout]
    _check_fields(kind, fields)
    stamp, host = _stamp(ts), _host()
    out = []
    for r in targets:
        name = REFLECTIONS if kind in REFLECTION_KINDS else GRADE_LOG if kind == "grade" else REVIEWS if r is None \
            else TUNINGS if kind == "tuning" else r
        out.append((name, _line(stamp, host, r, task, kind, fields)))
    return out


def _emit(rollout, kind, task, fields, ts, env):
    lines = _prepare(rollout, kind, task, fields, ts)
    try:
        base = events_dir(env)
    except Exception as e:
        _say("warning: cannot write the run record: %s" % e)
        return False
    ok = True
    for name, data in lines:
        path = os.path.join(base, name + ".jsonl")
        new = json.loads(data)
        ok = _write(path, data, new, kind) and ok
    return ok


def check(rollout, kind, task=None, fields=None, *, ts=None):
    """Raise Refused exactly where emit would refuse (its message the same); write nothing, print nothing."""
    _prepare(rollout, kind, task, fields, ts)


def emit(rollout, kind, task=None, fields=None, *, ts=None, env=None, strict=False):
    """Record one event. Returns True when recorded (or skipped as a duplicate fold), else False.

    A refusal prints one `run_record: refused:` line and returns False, or raises Refused when strict.
    A write failure, or anything unexpected, prints a warning and returns False either way.
    """
    try:
        return _emit(rollout, kind, task, fields, ts, env)
    except Refused as e:
        _say("refused: %s" % e)
        if strict:
            raise
        return False
    except Exception as e:
        _say("warning: cannot write the run record (%s): %s: %s" % (kind, type(e).__name__, e))
        return False


# ---- CLI -------------------------------------------------------------------------------------------------

class Parser(argparse.ArgumentParser):
    def error(self, message):
        _say("refused: %s" % message)
        sys.exit(2)


def main(argv):
    p = Parser(prog="run_record.py", description="The Run record's one writer (ADR 0032).")
    sub = p.add_subparsers(dest="verb", parser_class=Parser)
    e = sub.add_parser("emit", help="append one event")
    e.add_argument("--kind", required=True)
    e.add_argument("--rollout")
    e.add_argument("--task")
    e.add_argument("--json", dest="fields", help="the kind fields as a JSON object, or - for stdin")
    e.add_argument("--ts", help="the event's time, with an offset or Z (default now)")
    sub.add_parser("dir", help="print the resolved events directory")
    a = p.parse_args(argv)
    if a.verb == "dir":
        try:
            print(events_dir())
        except Exception as err:
            _say("cannot resolve the events directory: %s" % err)
            return 1
        return 0
    if a.verb != "emit":
        p.error("a verb is required: emit or dir")
    fields = None
    if a.fields is not None:
        raw = sys.stdin.read() if a.fields == "-" else a.fields
        try:
            fields = json.loads(raw)
        except ValueError as err:
            _say("refused: --json is not valid JSON: %s" % err)
            return 2
        if not isinstance(fields, dict):
            _say("refused: --json must be a JSON object")
            return 2
    try:
        emit(a.rollout, a.kind, a.task, fields, ts=a.ts, strict=True)
    except Refused:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
