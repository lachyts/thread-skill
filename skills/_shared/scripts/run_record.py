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
weekly reading's kinds (watch, watch-raised, proposal, reflection) to reflections.jsonl, and the Grade log's kind (grade)
to grades.jsonl. All four names are RESERVED: refused as a rollout slug and as a carried `from`.

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
reads it for the agreement and to refuse a closed Reflection): a `watch` line per (Reflection, Watch), a `watch-raised`
line per decided Watch, a `proposal` line per (Reflection, Tuning) at each altitude, and one `reflection` line that
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
    rollout  the rollout slug (null only for review-round, grade and the four reflections.jsonl kinds; a tuning's is
             a provenance stamp)
    task     the task slug, or null
    kind     one of the kinds below

The kind fields follow. Unknown extra keys are allowed (an optional `harness`, say); a key that collides
with a common key is refused.

Kinds (T: a task is required; `?` marks an optional field; every enum is closed):

  slot-taken      T  settings{parallel_ceiling (int >= 1), max_review_rounds?, max_iterations?,
                     max_plan_rounds? (ints >= 1), rung? (str)} (the effective values after per-task
                     overrides); start? (start | restart | revise | hand-back | resume); carriedFrom? (slug)
  run-bound       T  runId, journalDir; call? (task | revise | integrate | resume); resumedFrom?
  slot-freed      T  outcome (ready | set-aside | completed | lost | stopped | failed)
  ready           T  pr? (url or number)
  set-aside       T  stage (plan | implement | verify | review | integrate | gate), reasonClass (a string,
                     not checked as an enum; reconcile-rollout.py's table writes quota | call-failed |
                     merge-task | declined | prepare | revise-stopped | transient | gate | needs-human |
                     plan-rejected | review-rounds | approved-without-pr | integration-conflict |
                     integration-red | integration-set-aside | blocked, where needs-human, p16-3, is a stop on a
                     question for a person, never a plan or review round run out, and integration-conflict and
                     integration-red, p27-4, are an integrate set-aside opening the engine's named markers: an
                     Integration conflict, `integration: conflict unresolved in …`, and a verifier red at
                     Integration, `integration: verifier red: …`); setAsideAt? (run | integration | gate)
  lane-taken      T  (no fields)
  lane-freed      T  release (merge | set-aside | reject | halt); path?; triggers? (list of str);
                     conflict? (bool: `conflict` in triggers — a conflict Integration resolved, or, p27-4, an
                     unresolved Integration conflict that set the task aside)
  merged          T  pr?; readOnly? (bool)
  paused             mode (soft | hard | sign-off: reconcile-rollout.py await-sign-off, the queue left only gates for
                     Lachy and closed, ADR 0034)
  resumed            (no fields)
  hold-started       hold (merge | git-env | race)
  hold-ended         hold (merge | git-env | race)
  idle-slots         reason (dependency | solo | pause-drain | queue-tail | awaiting-hand-back |
                     hold-merge | hold-git-env | hold-race | hold-trickle: a row waits on the machine-wide Trickle,
                     execute away.md | hold-heat: a row waits for the Mac to cool, the Heat hold, execute away.md
                     § Heat); free (int >= 0); settings (as slot-taken)
  quota-stall        stage?; detail?
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
                     completion_verifier on merged origin/<default> at its completion ceremony; rc the run's
                     verbatim, 0-255, noslot, heat or absent; rerun is attempt 1's red, re-run on the same sha; flake
                     a green attempt 2 after it; noslot (no verify slot), unrun (verify never got going, the
                     env_bootstrap never let the suite run, or a git-env trip fell inside the window), stopped (a
                     signal stop: a TaskStop, a hard pause, a room stop) and heat (the Mac was too hot to run the
                     suite, the Heat hold) no verdict, the attempt runs again; followup
                     the fix task a final red filed; ADR 0052: completion-verify --run writes it).
  call-journal       runId; status (the journal's own status, verbatim); mode?; tokens?, durationMs?,
                     agents? (ints >= 0); startTime? (int >= 0: the journal's epoch ms, verbatim)
  review-round       repo, head, digest; doc?; mode?; effort?; findings?, original?, regression?
                     (ints >= 0); verdict?. No rollout, no task; lands in reviews.jsonl.
  review-verdict  T  round (int >= 1), verdict (approve | changes), findings, original, regression (ints >= 0;
                     original + regression <= findings, the rest unclassified), digest (verdict_digest of the
                     verdict and its bullets); head? (the PR head the judge judged, resolved to a full sha in the
                     task tree; omitted when the judge gave none). One line per judged master-review round,
                     written by reconcile-rollout.py from the row's reviewVerdicts; lands in <rollout>.jsonl.
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
                     agreeing, agreed?}); binding? (slot-bound | lane-bound | quota-bound | dependency-bound |
                     none-clear); voids? (the id of the line this one voids); close? (completion | supersede: the close
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
  watch              id, rule, shape, rollouts, count, reflection (p21-7: one per (Reflection, Watch); id is
                     watch_id(rule, shape); rule and shape stripped, each at most 120 characters; rollouts 1 to 64
                     slugs, none reserved, every rollout where the Reflection saw it; count an integer >= 1).
                     No rollout, no task; lands in reflections.jsonl.
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
                     parallel | serial | session; size S | M | L; decisions and low integers >= 0, the decision count
                     and those of low confidence, low <= decisions; held a boolean, the task held by a dependency; gates
                     a list of distinct gate kinds, spend | credential | irreversible, possibly empty; raised a
                     non-empty list of distinct raise whys, decisions | confidence; rank an integer >= 1, absent for
                     Orient; linked the scan row's rollout slug at grade time, never a reserved name). No rollout; lands
                     in grades.jsonl.
  reflection         id, since, until, rollouts, escapesOnly, counts, quiet; decisionTask?, cadence?, repairsOnly?
                     (p21-7: the Reflection's one closing line; since and until UTC Z stamps; rollouts, escapesOnly
                     and repairsOnly lists of slugs: the rollouts read, those not read that hold an in-window
                     Escape, and those not read that hold only in-window repair lines, repairsOnly written only when
                     non-empty; counts exactly sightings, newWatches, rules, bugs, filed, knobs, landed, reverted and
                     breaches, each an integer >= 0; quiet a boolean; cadence 7 or 14, absent read as 7). No
                     rollout, no task; lands in reflections.jsonl.

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
  one of them this Reflection's. A Watch is new only at its id's first-ever `watch` line.
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
  line from before p21-8) reads as 7.
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
regression exceed its findings), with one line starting `run_record: ` on
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
BINDINGS = ("slot-bound", "lane-bound", "quota-bound", "dependency-bound", "none-clear")
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
REFLECTION_KINDS = ("watch", "watch-raised", "proposal", "reflection")
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


HOLDS = ("merge", "git-env", "race")
# kind -> (task required, required fields, optional fields)
KINDS = {
    "slot-taken": (True, {"settings": SETTINGS},
                   {"start": _enum("start", "restart", "revise", "hand-back", "resume"), "carriedFrom": _str}),
    "run-bound": (True, {"runId": _str, "journalDir": _str},
                  {"call": _enum("task", "revise", "integrate", "resume"), "resumedFrom": _str}),
    "slot-freed": (True, {"outcome": _enum("ready", "set-aside", "completed", "lost", "stopped", "failed")}, {}),
    "ready": (True, {}, {"pr": _pr}),
    "set-aside": (True, {"stage": _enum("plan", "implement", "verify", "review", "integrate", "gate"),
                         "reasonClass": _str}, {"setAsideAt": _enum("run", "integration", "gate")}),
    "lane-taken": (True, {}, {}),
    "lane-freed": (True, {"release": _enum("merge", "set-aside", "reject", "halt")},
                   {"path": _str, "triggers": _strlist, "conflict": _bool}),
    "merged": (True, {}, {"pr": _pr, "readOnly": _bool}),
    "paused": (False, {"mode": _enum("soft", "hard", "sign-off")}, {}),
    "resumed": (False, {}, {}),
    "hold-started": (False, {"hold": _enum(*HOLDS)}, {}),
    "hold-ended": (False, {"hold": _enum(*HOLDS)}, {}),
    "idle-slots": (False, {"reason": _enum("dependency", "solo", "pause-drain", "queue-tail", "awaiting-hand-back",
                                           "hold-merge", "hold-git-env", "hold-race", "hold-trickle", "hold-heat"),
                           "free": _int(0), "settings": SETTINGS}, {}),
    "quota-stall": (False, {}, {"stage": _str, "detail": _str}),
    "auto-retry": (True, {"stage": _enum("plan", "implement", "verify", "review", "integrate"),
                          "setAsideAt": _enum("run", "integration"), "retryClass": _enum("agent", "infra", "quota"),
                          "used": _int(0), "budget": _int(1)},
                   {"fingerprint": _str, "reviewRounds": _int(1), "quotaRetries": _int(1)}),
    # result: reconcile-rollout.py's COMPLETION_RESULTS, in its order.
    "completion-verify": (False, {"result": _enum("green", "flake", "red", "rerun", "noslot", "unrun", "stopped",
                                                  "heat"),
                                  "rc": _str, "sha": _str, "attempt": _int(1, 2)}, {"log": _str, "followup": _str}),
    "call-journal": (False, {"runId": _str, "status": _str},
                     {"mode": _str, "tokens": _int(0), "durationMs": _int(0), "agents": _int(0),
                      "startTime": _int(0)}),
    "review-round": (False, {"repo": _str, "head": _str, "digest": _str},
                     {"doc": _str, "mode": _str, "effort": _str, "findings": _int(0), "original": _int(0),
                      "regression": _int(0), "verdict": _str}),
    "review-verdict": (True, {"round": _int(1), "verdict": _enum("approve", "changes"), "findings": _int(0),
                              "original": _int(0), "regression": _int(0), "digest": _str},
                       {"head": _str}),
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
                      "rollouts": _slugs(1, MAX_ROLLOUTS), "count": _int(1), "reflection": _rid}, {}),
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


def _line(ts, host, rollout, task, kind, fields):
    obj = {"v": KIND_VERSIONS.get(kind, VERSION), "ts": ts, "host": host, "rollout": rollout, "task": task, "kind": kind}
    obj.update(fields)
    try:
        text = json.dumps(obj, ensure_ascii=True, allow_nan=False, separators=(",", ":"))
    except ValueError as e:
        raise Refused("%s: %s" % (kind, e))
    except TypeError as e:
        raise Refused("%s: a field is not JSON: %s" % (kind, e))
    data = (text + "\n").encode("ascii")
    if len(data) > MAX_LINE:
        raise Refused("%s: the line is %d bytes, over the %d-byte limit" % (kind, len(data), MAX_LINE))
    return data


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
