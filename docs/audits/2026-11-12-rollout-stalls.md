# Audit — what actually stalls rollouts, cause by cause (2026-11-12)

Task: `thread-skill-p47-1-audit-rollout-stalls-by-cause` (rollout `thread-skill-rollout-2026-11-12`). Read-only: this
report changes no engine code.

**Window.** 2026-10-13T13:00Z to 2026-11-12T03:00Z (Melbourne 14 October 00:00 to 12 November 14:00), the last 30 days.
**Records.** `_shared/state/thread-events/` holds 93 `*-rollout-*.jsonl` files. Ten of them end before the window
(chorus-10-06 to 10-13, event-script-10-07 and 10-10, thread-skill-10-09), so 83 have a line in it. The ledger's own
flags then leave out ten serial chains (animately-app-11-10, focus-folder-11-10, giflab-11-10, narcissus-echo-10-23,
next-action-11-10, seo-11-07, seo-11-07-2, seo-11-08, smart-slider-11-03-2 and website-re-design-11-10) and price
nothing for four records with no engine line yet (demo-10-20, giflab-09-23, seo-11-02, thread-skill-10-21). That
leaves 69 rollouts priced, and this audit reads those 69.

## The short answer

The 450 lane-bound hours are not one cause. Read hold by hold, the long lane holds (264 of them over 30 minutes,
368.8 h) first give back 19.8 h that the ledger already prices as a stall under its own recorded cause: a git-env hold
(15.2 h), Mac sleep (2.8 h), a usage-limit stop (1.0 h) and a dead lead (0.8 h). The 349.0 h left split into three
main causes:

1. **A lead that stopped while it held the lane, with nothing to start it again (158 h, 45%).** The record has no line
   for hours: the lead's session ended (a room stop, a killed merge-task, the Mac asleep, the lead turn over), and the
   lane stayed held until someone re-entered. This was 82 h in the week of 13 October, 38 h in each of the next two
   weeks, and **none since 3 November**: the one lead that died holding the lane since then (thread-skill-11-10) was
   recorded as `dead-lead`, and the Chorus Watchdog re-entered it 48 minutes later. The stop model, the lead-entry
   heartbeat (p29-10) and the Chorus Watchdog (ADR 0048) have largely fixed it. The ledger still prices this time as
   `lane-bound`.
2. **Thread Skill's required GitHub CI running inside the lane (69 h; 59 h of it since 3 November).** Under the strict
   up-to-date ruleset the lead keeps the lane until both `make test` jobs pass. The median CI run per push doubled,
   from 0.30 h before 3 November to 0.61 h since. Since 3 November this is the main lane cost, and it is real.
3. **A CI job that no runner ever took (23 h, almost all of it in [[compression-engine-rollout-2026-11-08]]).** The
   `alpine` job runs on a self-hosted runner that no longer exists, so it stayed queued. The job was not required.
   But `master` had branch protection that required no checks, so merge-task read the PR as needing checks and kept
   waiting for it. Each `infra` retry ran the same wait again.

Most of the 306 stall hours carry the right label. Four labels hide their cause (118 h in all):

- `hold-trickle`: 52.1 h of its 101.4 h is one rollout, `event-scanner-rollout-2026-10-29`. Its lead wrote a Trickle
  marker on 29 October and nothing re-entered it until 31 October. That is cause 1, not the Trickle.
- `cool-down`: none of its 27.8 h is a cool-down. All of it is a question to Lachy (row 5). 18.3 h is a lead's own
  chat question (giflab-11-02, Monthly audit gap 4). 5.3 h is chorus-10-31's lead waiting on his word to run a seeded
  revise without its 57 KB plan. 4.3 h is a recorded `needs-human` question (chorus-10-26), read as a cool-down because
  its set-aside line is written 1 ms after the slot-freed that opens the wait.
- `lead-absent`: 32.0 h of its 36.4 h is the Login billing refusal of 7 November (row 8, Monthly audit gap 2). The
  other 4.3 h is no stall at all. It is a gated task's resumed run after its sign-off: the resume reuses its runId, so
  score.py reads the first call's end and prices the run as an absent lead (gap 3).
- `unexplained`: its one span over 30 minutes (thread-skill-10-31, 1.5 h) is a room stop that was written only to the
  Pause log (gap 1, row 16).

## Method

1. **Stall classes.** `skills/reflect/scripts/ledger.py --since 2026-10-13T13:00:00Z --until 2026-11-12T03:00:00Z`
   gives the whole-estate row: stalls 306.2 h, lane-bound 450.7 h, plan-rejected 80.8 h, load 21.5 h, rework 8.7 h,
   quota-bound 3.1 h. Its `intervals` give every priced span with its class, cause and rollout. The same command was
   also run once per record, each record copied alone into a scratch `THREAD_EVENTS_DIR`, to see which rollouts each
   cause hit (the estate row names only each class's top 8).
2. **Lane holds.** Each `lane-taken` .. `lane-freed` pair per record, at the lines' own times (a take while another
   holding is open closes that one; a holding still open runs to the record's last line), clipped to the window, kept
   when over 30 minutes: 264 holds, 368.8 h.
3. **Recorded stalls first.** Where the ledger already prices part of a hold as a stall (a hold or a stop span in its
   `intervals`), that part goes to its recorded cause's row and leaves the lane rows. That is 19.8 h: hold-git-env
   15.2 h (almost all of it inside chorus-10-18's p82-1 hold), mac-sleep 2.8 h, usage-limit 1.0 h and dead-lead
   0.8 h. No pause fell inside a hold. Rules D and E below read only what is left of each hold, 349.0 h in all.
4. **PR history.** For each hold, the task's PR was read through `gh api graphql`: its commits in the hold, every check
   run (start, end, conclusion) and `mergedAt`. That is 227 PRs.
5. **One cause per hold, the first rule that matches:**
   - **A:** a CANCELLED, TIMED_OUT or over-3-hour check, with a `merge-task` set-aside or a run over 3 hours.
   - **B:** released by a `halt`.
   - **C:** a `merge-gate` set-aside.
   - **D:** the lead was gone for at least half of what is left of the hold. "Gone" means stretches over 30 minutes
     with no record line and no CI run.
   - **E:** CI ran for at least half of what is left of the hold.
   - **F:** any other set-aside or reject.
   - **G:** anything else.

   Rules D and E are what separate a lead's absence from a CI wait. Without them the record shows only "lane held".
6. **Task notes and rollout notes**, for the vague labels: Pause logs, Git-env logs, repair lines and Blocker
   diagnoses (cited in each row).

The ledger's lane class (450.7 h) also counts holds under 30 minutes and the origin waits between yields. It subtracts
every stall span, the pauses and the rework suites. Step 3 takes out the stall spans too, but the hold-by-hold read
keeps the rework suites and the room stops the record never wrote (gap 1). So the lane rows below add up to 349.0 h, not
450.7 h.

## The ranked table

Ranked by hours lost. **Sort** is one of three: **resolves itself today**, **could resolve itself with a change**,
or **needs Lachy**.

| # | Cause (real, not label) | Hours | Rollouts hit | Fix exists | Live? | Sort |
|---|---|---|---|---|---|---|
| 1 | A lead stopped and nothing restarted it, so the lane or a Trickle hold stayed held (lane D 157.9 h; `event-scanner-rollout-2026-10-29`'s 52.1 h labelled `hold-trickle`; one recorded `dead-lead` that held the lane, thread-skill-11-10, 0.8 h) | 210.8 | 19 (event-scanner-10-29 63.8, chorus-10-18 28.2, thread-skill-10-31 18.2, chorus-10-17 15.9, chorus-10-14 12.2, chorus-10-23 11.4) | p29-10 (stop model, lead-entry heartbeat, merged 10-27); ADR 0048 Chorus Watchdog; chorus-p70-3 keep-awake (10-15) | **Yes**: lane D 82 → 38 → 38 → 0 h a week; the one dead lead since 3 November was re-entered by the Watchdog in 48 minutes | Resolves itself today. The ledger still prices it as `lane-bound` or `hold-trickle`: new task [[thread-skill-ledger-prices-an-absent-lead-as-a-stall]] |
| 2 | Plan-gate rejections: Slot hours spent on a plan that was then thrown away (Slot time, not rollout time) | 80.8 | 35 (thread-skill-10-26 7.1, chorus-10-26 6.3, thread-skill-11-08 5.2) | Partly: [[thread-skill-p47-13-the-plan-gate-rejects-what-review-can-never-close]] | No (scheduled) | Mostly by design (the gate stopping bad plans); could resolve itself with a change for the kind p47-13 names |
| 3 | Thread Skill's required GitHub CI (`make test`, macOS and Ubuntu) runs while the lead holds the lane, under the strict up-to-date ruleset. Median run per push went from 0.30 h to 0.61 h | 69.0 | 8, all thread-skill (11-08 14.1, 11-06 12.6, 11-03 11.4, 11-05 8.7) | P49-1 to P49-5 (split the Leg suite, per-OS limits, node file weights, node 24, one flake one follow-up); [[thread-skill-p47-10-a-timed-out-test-step-is-retried-once]]; ADR 0080 / [[thread-skill-p47-9-a-stuck-rollout-changes-its-repos-merge-settings]] | No (scheduled in thread-skill-rollout-2026-11-12) | Could resolve itself with a change |
| 4 | Integration work over 30 minutes: the lead's verify, the integrator, the judge | 54.6 | 23 | Not a stall | n/a | Resolves itself today |
| 5 | Questions to Lachy: needs-human answers (26.2 h), plus three waits priced as `cool-down` (27.8 h): giflab-11-02's lead's chat question (18.3 h; Monthly audit gap 4); chorus-10-31's lead waiting on his word to run p95-5's seeded revise without its 57 KB approved plan, which it could not pass verbatim in the call's args (5.3 h); chorus-10-26's recorded needs-human question on p88-1 (4.3 h), whose set-aside line is 1 ms after the slot-freed that opens the wait | 54.1 | 6 (giflab-11-02 18.3, event-scanner-10-29 11.6, chorus-10-26 9.1, chorus-10-29 8.0, chorus-10-31 5.3, thread-skill-11-08 1.8) | Recording the chat question is gap 4, which waits on Lachy's yes in [[thread-skill-decisions-2026-11-09]]; new tasks [[thread-skill-a-seeded-revise-reads-its-plan-from-the-note]] (p27-1 did this for the integrate call only) and [[thread-skill-ledger-reads-a-wait-by-the-set-aside-that-opens-it]] | No | Needs Lachy (the answers); the plan and the label could resolve themselves with a change |
| 6 | The Trickle and the Away cap, the Mac-wide caps, holding a start (the rest of `hold-trickle`, 49.2 h, and `hold-away-cap`, 2.0 h) | 51.2 | 43 | By design (ADR 0049) | Yes | Resolves itself today |
| 7 | Gate sign-offs: real spend, credential or irreversible gates (e.g. chorus p84-7: a US$5 cap plus two API keys that the standing approval refused; thread-skill p33-4: create a scratch GitHub repo) | 43.4 | 7 (thread-skill-10-17 14.6, chorus-10-18 9.0, smart-slider-10-28 8.8, thread-skill-10-31 8.7) | ADR 0074 (sign-ins at schedule, proposed) and the standing approval | Partly | Needs Lachy (can be caught at preflight) |
| 8 | Login billing refusal ("payment is past due", 2026-11-07 05:57Z to 22:33Z). Dead calls kept their Slots open, so it read as `lead-absent` (Monthly audit gap 2) | 32.0 | 2 (thread-skill-11-07 16.0, giflab-11-07 16.0) | [[thread-skill-p46-3-an-allowance-refusal-is-its-own-outcome]] | No (scheduled) | Needs Lachy to pay; the stop's labelling could resolve itself with p46-3 |
| 9 | git-env trips: in-place peer commits (agent-stable-10-18), the lead's unarmed record (chorus-10-18: the 15.2 h inside p82-1's lane hold, Method step 3), a space-named task note (chorus-11-02, "Chorus multi-photo import workflow", 11.75 h) | 30.8 | 3 | p26-2 (every rollout runs from its clone, live); p29-2 (live); [[thread-skill-p47-6-a-space-named-note-halts-a-rollout]] | Partly (p47-6 scheduled) | Could resolve itself with a change |
| 10 | A halt while the lead held the lane. Examples: a false git-env trip (chorus p80-1, 15.2 h, "record not armed"); a room stop that killed merge-task ("failed:143") with the lane held (thread-skill p34-1, 6.9 h) | 30.5 | 8 (chorus-10-18 16.0, thread-skill-10-31 7.8) | p29-2 (a proven-false trip acks itself, 10-28); p29-10 records room stops; [[thread-skill-p47-2-a-repeat-stall-frees-the-lane-and-keeps-its-diagnosis]] | Partly (p47-2 scheduled) | Could resolve itself with a change |
| 11 | merge-task waits forever on a CI job no runner takes and no rule requires (compression-engine's self-hosted `alpine`), under a protection that requires no checks. `infra` retries repeat the wait | 23.2 | 3 (compression-engine-11-08 18.2) | 9ae5d7f (merge an UNSTABLE PR; merged 11-08, after that rollout's engine snapshot bf3ed049 was cut); P43-4 (a cancelled check reads as a CI timeout, 11-09); #370 (no-runner, required jobs only, 11-11); open: [[thread-skill-p47-3-merge-task-unstable-guard-follow-ups]], [[thread-skill-bug-merge-task-protected-no-required-checks]], [[thread-skill-merge-task-empty-required-checks-reads-as-some]], [[thread-skill-p47-2-a-repeat-stall-frees-the-lane-and-keeps-its-diagnosis]], [[compression-engine-ci-and-test-debt]] (retire `alpine`) | Partly | Could resolve itself with a change |
| 12 | Integration rework (conflict, red, reject; 9.0 h), merge-gate red after verify (4.8 h) and re-run integration suites (8.7 h) | 22.5 | 21 | ADR 0068 (schedule reads the merge gate) | Yes | Resolves itself today |
| 13 | Hand-back waits. Thread-skill-11-06: two set-asides overnight (7.6 h). Thread-skill-11-08: "nothing can start: 0 set aside", a dependency on chorus-p100-8 that was left out of its queue (5.7 h). Chorus-11-04: a merge-task set-aside with no mover (7.75 h) | 21.2 | 3 | ADR 0078 d7 / p45-5 (nothing is left out silently, merged 11-11); p47-2 and p47-3 for the merge-task stop | Live, not yet proven | Mixed: the overnight set-asides need Lachy; the other two could resolve themselves with a change |
| 14 | Verify-slot waits (load) | 20.4 | 27 | By design (verify-slot) | Yes | Resolves itself today |
| 15 | Mac sleep while a rollout ran (2.8 h of it inside lane holds, Method step 3) | 12.2 | 15 (thread-skill-11-10 8.3) | chorus-p70-3 keep-awake (live; a closed lid still wins) | Yes | Needs Lachy (the lid); resumes on wake |
| 16 | Room stops at a usage limit: 3.1 h recorded (1.0 h of it inside lane holds, Method step 3), plus 50.3 h written only to the Pause logs before 2026-11-03 (69 room stops; Monthly audit gap 1 counted the 30.8 h of them from 21 October) | 3.1 (+50.3) | 3 recorded, 21 before | Stop driver and quota hold (p36-7) | Yes | Resolves itself today |

**The rows overlap, so do not add them up.** Row 2 counts Slot hours and row 14 verify-slot hours, while the rest
count rollout or lane hours, and one stop across four rollouts counts four times (the ledger's own unit). The lane rows
(lane D in row 1, rows 3, 4, 10 and 11, and the rework and merge-gate holds in row 12) still keep two things the record
never priced as a stall. First, 7.3 h of row 12's 8.7 h of re-run suites ran inside lane holds that rows 3, 4 and 12
also count. Second, row 16's unrecorded room stops. **Row 16's +50.3 h is mostly not inside row 1, and none of it is
extra to row 1:** 9.5 h lies inside row 1's lane holds and is already part of its 157.9 h (which is why the short answer
names a room stop as one of its causes). 3.4 h lies inside row 10's holds and 2.7 h inside row 4's. 1.5 h is the
`unexplained` span that row 16 places. 0.7 h falls in rows 2, 3 and 14 and in lane holds under 30 minutes. The other
32.5 h reads as running time, because the Slots stayed open while they drained, so it is in no row.

**Left unranked:** 2.5 h of `unexplained` in 98 spans under 30 minutes (none over 20 minutes), below the brief's
30-minute bar. Every stall span over 30 minutes is in a row above, or, for the 4.3 h of resumed work read as
`lead-absent`, under "Not stalls" below.

Not stalls, kept for scale (the ledger's `other`, and one mislabel):

- **Lachy's own pauses: 46.3 h.** Of these, 21.3 h is `animately-app-rollout-2026-11-07`'s hard pause "until
  [[thread-skill-merge-task-empty-required-checks-reads-as-some]] lands", which is Monthly audit gap 7. A durable
  trigger, ADR 0078 d5 (p45-7, merged 11-11), now carries that kind of wait.
- **Dependency waits: 50.4 h.** smart-slider-10-28 30.6 h and thread-skill-10-26 15.9 h. This is queue order.
- **Resumed work read as `lead-absent`: 4.3 h** (thread-skill-10-31 2.6, smart-slider-10-28 1.2, thread-skill-10-17
  0.5). Each is a gated task's run after Lachy signed its gate. The resume reuses the runId and writes no new
  call-journal line, so score.py reads the first call's end and prices the run as an absent lead (Monthly audit gap 3,
  which waits on Lachy's yes in [[thread-skill-decisions-2026-11-09]]).

### What changed over the month (lane holds over 30 minutes, hours)

Each hold counts in the week it started (weeks from 00:00 UTC). The last column is Method step 3's recorded stalls,
which go to their own rows.

| Week starting | A stuck check | B halt | C merge-gate | D lead stopped | E CI in lane | F rework | G work | Recorded stall |
|---|---|---|---|---|---|---|---|---|
| 13 Oct | 0 | 17.9 | 0 | 81.9 | 0 | 1.7 | 22.8 | 15.2 |
| 20 Oct | 0 | 4.2 | 0 | 38.1 | 0.5 | 2.2 | 9.7 | 0 |
| 27 Oct | 3.1 | 7.8 | 0 | 37.9 | 9.9 | 3.8 | 12.9 | 0 |
| 3 to 12 Nov | 20.1 | 0.5 | 4.8 | 0 | 58.6 | 1.3 | 9.2 | 4.7 |

Before 3 November, the lane was held mostly while its lead was not running. Since then it is held by CI: Thread Skill's
own CI, and one job that no runner took.

## Why compression-engine-rollout-2026-11-08 scored `none-clear`

Re-scored with `score.py --rollout compression-engine-rollout-2026-11-08 --until 2026-11-09T03:08:42.519Z`, which
gives the close line's numbers again. No rule in score.py's Binding held:

- **Lane-bound needs the lane busy for at least 80% of running time. It read 71%.** The lane was held for 18.8 h in
  total, all of it lane-only: no Slot was open. But running time counts a lane-only stretch for at most
  `LANE_ONLY_CAP` (2 h). The lane-only stretches ran 3.6, 4.0, 4.0, 4.0 and 2.2 h, so score.py cut five
  `lane-only-over-cap` spans of 1.58, 2.01, 2.01, 2.01 and 0.25 h (7.86 h in all) from running time and from lane
  busy time together. That left 10.96 busy hours out of 15.36 running hours. Counted in full, the share is
  18.8 / 23.2 = 81%, and the rule holds.
- **Waits climbing did not hold either, because the stall came first.** The rule compares the mean of the last third
  of the ready-to-lane waits with the mean of the first third: it needs the later mean over twice the earlier one and
  at least 10 minutes. The first third was 0.3, 215, 163 and 204 minutes (mean 145.4). The last third was 0.2 minutes
  each (mean 0.2). The waits fell.
- **Dependency-bound needs dependency or Solo to be the largest idle reason. It was `unexplained`** (25.0 h of 61.4
  capacity hours). The Slots sat idle because the lane was stuck, and no idle-slots reason names that.

**What it should have said:** `lane-bound`, with the reason that one Integration stood on a CI job no runner took
(`alpine`) for 18.3 of the rollout's 25 active hours. The 2-hour cap was added so that an overnight absent lead would
not count as running. On a stuck merge-task it hides the stall instead: the lead is present and waiting, and that wait
is exactly what binds the run. New task: [[thread-skill-score-a-stuck-lane-reads-lane-bound]].

## Is built actually live?

- **The Primary checkout is live.** `~/repos/tools/thread-skill` is 0 ahead and 0 behind origin/master at 89f5429
  (2026-11-12). `primary-live.json` has had it current since 12:58 +11:00. The diverged spell of 2026-11-11 (ahead 2,
  behind 3) was carried to PR #366 by the d4 repair (ADR 0078), not left in place, so the repair works.
- **The refresh job has already been re-installed.** `primary-refresh.installed` is dated 2026-11-09 18:51. The
  log's last `job: the launchd job predates this copy` line is from 18:55 that day, and the job has run every
  5 minutes since. [[thread-skill-reinstall-the-primary-refresh-job]] looks done. Its own done-when ("the log reads
  `job: current`") was never written as such, because the job writes nothing once it is current. Lachy can close it.
- **Nothing is Proven yet.** `prove` reads `9 carried, 0 proven`. Under ADR 0078 d1 no carried fix counts as done.
  Most carried fixes wait on something not being seen again, such as "the Primary checkout diverging" or "landing PRs
  stalling unmerged".
- **Running rollouts keep the engine they were scheduled with.** A stamped rollout re-cuts its Engine snapshot only at
  a hard pause (parallel) or after a stopped Leg (serial) (ADR 0043; `engine-snapshot.py`'s header). Two examples:
  - compression-engine-rollout-2026-11-08 ran on bf3ed049, cut 2026-11-07 16:30 +11:00. That snapshot has neither the
    UNSTABLE fix (9ae5d7f, merged about an hour before the run began) nor P43-4.
  - The live serial chains `giflab-rollout-2026-11-10` and `quote-videos-rollout-2026-11-10` run on c6b300474de6,
    36 commits behind origin/master.

  ADR 0078 d6 (p45-6) puts a fix into a running rollout's *queue*. It does not put the fix's *code* into that
  rollout's engine. New task: [[thread-skill-a-running-rollout-reaches-the-fixes-it-waits-on]].

## Where each cause goes

- **Resolves itself today:** 1 (except the mislabel), 4, 6, 12, 14, 16.
- **Could resolve itself with a change:** 3 (P49, p47-9, p47-10), 9 (p47-6), 10 (p47-2), 11 (p47-2, p47-3 and the two
  merge-task bug tasks, compression-engine-ci-and-test-debt), 13 (p47-2, p47-3), 2 (p47-13, partly), and the
  seeded revise's plan in 5. Also the scoring and labelling faults: the ledger task, the wait-label task, the score
  task, and the engine-snapshot task.
- **Needs Lachy:** 5 (questions), 7 (gates, which preflight can catch), 8 (billing), 15 (the lid), and the overnight
  set-asides in 13.

[[thread-skill-grill-rollouts-resolve-themselves]] took this audit as its input. It was grilled at the
2026-11-12 orient (ADR 0080: any merge setting may change), so the rows above that point at p47-9 follow that ruling.
