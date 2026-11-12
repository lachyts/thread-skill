# Audit — what actually stalls rollouts, cause by cause (2026-11-12)

Task: `thread-skill-p47-1-audit-rollout-stalls-by-cause` (rollout `thread-skill-rollout-2026-11-12`). Read-only: this
report changes no engine code.

**Window.** 2026-10-13T13:00Z to 2026-11-12T03:00Z (Melbourne 14 October 00:00 to 12 November 14:00), the last 30 days.
**Records.** Every `_shared/state/thread-events/*-rollout-*.jsonl` whose live span reaches the window (93 records; the
two serial chains, `animately-app-rollout-2026-11-10` and `focus-folder-rollout-2026-11-10`, are left out, as the ledger
leaves them out).

## The short answer

The 450 lane-bound hours are not one cause. Read hold by hold, the long lane holds (264 of them over 30 minutes,
371 h) split into three main causes:

1. **A lead that stopped while it held the lane, with nothing to start it again (176 h, 48%).** The record has no line
   for hours: the lead's session ended (a room stop, a killed merge-task, the Mac asleep, the lead turn over), and the
   lane stayed held until someone re-entered. This was 97 h in the week of 13 October, 38 h in each of the next two
   weeks, and **3 h since 3 November**. The stop model, the lead-entry heartbeat (p29-10) and the Chorus Watchdog
   (ADR 0048) have largely fixed it. The ledger still prices this time as `lane-bound`.
2. **Thread Skill's required GitHub CI running inside the lane (71 h; 61 h of it since 3 November).** Under the strict
   up-to-date ruleset the lead keeps the lane until both `make test` jobs pass. The median CI run per push doubled,
   from 0.30 h before 3 November to 0.61 h since. Since 3 November this is the main lane cost, and it is real.
3. **A CI job that no runner ever took (23 h, almost all of it in [[compression-engine-rollout-2026-11-08]]).** The
   `alpine` job runs on a self-hosted runner that no longer exists, so it stayed queued. The job was not required.
   But `master` had branch protection that required no checks, so merge-task read the PR as needing checks and kept
   waiting for it. Each `infra` retry ran the same wait again.

The 306 stall hours are mostly labelled correctly. Two labels are wrong:

- `hold-trickle`: 52 h of its 101 h is one rollout, `event-scanner-rollout-2026-10-29`. Its lead wrote a Trickle
  marker on 29 October and nothing re-entered it until 31 October. That is cause 1, not the Trickle.
- `cool-down`: 18 h of its 28 h is a lead's own chat question, which is Monthly audit gap 4.

## Method

1. **Stall classes.** `skills/reflect/scripts/ledger.py --since 2026-10-13T13:00:00Z --until 2026-11-12T03:00:00Z`
   gives the whole-estate row: stalls 306.2 h, lane-bound 450.7 h, plan-rejected 80.8 h, load 21.5 h, rework 8.7 h,
   quota-bound 3.1 h. The same command was then run once per record, each record copied alone into a scratch
   `THREAD_EVENTS_DIR`, to see which rollouts each cause hit (the estate row names only each class's top 8).
2. **Lane holds.** Each `lane-taken` .. `lane-freed` pair per record (a take while another holding is open closes that
   one; a holding still open runs to the record's last line), clipped to the window, kept when over 30 minutes.
3. **PR history.** For each hold, the task's PR was read through `gh api graphql`: its commits in the hold, every check
   run (start, end, conclusion) and `mergedAt`. That is 227 PRs.
4. **One cause per hold, the first rule that matches:**
   - **A:** a CANCELLED, TIMED_OUT or over-3-hour check, with a `merge-task` set-aside or a run over 3 hours.
   - **B:** released by a `halt`.
   - **C:** a `merge-gate` set-aside.
   - **D:** the lead was gone for at least half the hold. "Gone" means stretches over 30 minutes with no record line
     and no CI run.
   - **E:** CI ran for at least half the hold.
   - **F:** any other set-aside or reject.
   - **G:** anything else.

   Rules D and E are what separate a lead's absence from a CI wait. Without them the record shows only "lane held".
5. **Task notes and rollout notes**, for the vague labels: Pause logs, Git-env logs, repair lines and Blocker
   diagnoses (cited in each row).

The ledger's lane class (450.7 h) also counts holds under 30 minutes and the origin waits between yields. It subtracts
stops and pauses, which the hold-by-hold read keeps. So the lane rows below add up to 371 h, not 450.7 h.

## The ranked table

Ranked by hours lost. **Sort** is one of three: **resolves itself today**, **could resolve itself with a change**,
or **needs Lachy**.

| # | Cause (real, not label) | Hours | Rollouts hit | Fix exists | Live? | Sort |
|---|---|---|---|---|---|---|
| 1 | A lead stopped and nothing restarted it, so the lane or a Trickle hold stayed held (lane D 176.4 h, plus `event-scanner-rollout-2026-10-29`'s 52.2 h labelled `hold-trickle`) | 228.6 | 21 (chorus-10-18 43.5, thread-skill-10-31 18.2, chorus-10-17 15.9, chorus-10-14 12.3, event-scanner-10-29 63.8, chorus-10-23 11.4) | p29-10 (stop model, lead-entry heartbeat, merged 10-27); ADR 0048 Chorus Watchdog; chorus-p70-3 keep-awake (10-15) | **Yes**: 97 → 38 → 38 → 3 h a week | Resolves itself today. The ledger still prices it as `lane-bound` or `hold-trickle`: new task [[thread-skill-ledger-prices-an-absent-lead-as-a-stall]] |
| 2 | Plan-gate rejections: Slot hours spent on a plan that was then thrown away (Slot time, not rollout time) | 80.8 | 35 (thread-skill-10-26 7.1, chorus-10-26 6.3, thread-skill-11-08 5.2) | Partly: [[thread-skill-p47-13-the-plan-gate-rejects-what-review-can-never-close]] | No (scheduled) | Mostly by design (the gate stopping bad plans); could resolve itself with a change for the kind p47-13 names |
| 3 | Thread Skill's required GitHub CI (`make test`, macOS and Ubuntu) runs while the lead holds the lane, under the strict up-to-date ruleset. Median run per push went from 0.30 h to 0.61 h | 71.4 | 8, all thread-skill (11-08 14.4, 11-06 12.7, 11-03 11.6, 11-10 9.6) | P49-1 to P49-5 (split the Leg suite, per-OS limits, node file weights, node 24, one flake one follow-up); [[thread-skill-p47-10-a-timed-out-test-step-is-retried-once]]; ADR 0080 / [[thread-skill-p47-9-a-stuck-rollout-changes-its-repos-merge-settings]] | No (scheduled in thread-skill-rollout-2026-11-12) | Could resolve itself with a change |
| 4 | Integration work over 30 minutes: the lead's verify, the integrator, the judge | 54.3 | 22 | Not a stall | n/a | Resolves itself today |
| 5 | The Trickle, the Mac-wide cap, holding a start (the rest of `hold-trickle`) | 49.2 | 40 | By design (ADR 0049) | Yes | Resolves itself today |
| 6 | A halt while the lead held the lane. Examples: a false git-env trip (chorus p80-1, 15.2 h, "record not armed"); a room stop that killed merge-task ("failed:143") with the lane held (thread-skill p34-1, 6.9 h) | 31.4 | 8 (chorus-10-18 16.0, thread-skill-10-31 7.8) | p29-2 (a proven-false trip acks itself, 10-28); p29-10 records room stops; [[thread-skill-p47-2-a-repeat-stall-frees-the-lane-and-keeps-its-diagnosis]] | Partly (p47-2 scheduled) | Could resolve itself with a change |
| 7 | Questions to Lachy: needs-human answers (26.2 h), plus one lead's chat question priced as `cool-down` (giflab-11-02, 18.3 h; Monthly audit gap 4) | 44.5 | 5 (event-scanner-10-29 11.6, giflab-11-02 18.3, chorus-10-29 8.0, chorus-10-26 4.8) | Recording the chat question is gap 4, which waits on Lachy's yes in [[thread-skill-decisions-2026-11-09]] | n/a | Needs Lachy |
| 8 | Gate sign-offs: real spend, credential or irreversible gates (e.g. chorus p84-7: a US$5 cap plus two API keys that the standing approval refused; thread-skill p33-4: create a scratch GitHub repo) | 43.4 | 7 (thread-skill-10-17 14.6, chorus-10-18 9.0, smart-slider-10-28 8.8, thread-skill-10-31 8.7) | ADR 0074 (sign-ins at schedule, proposed) and the standing approval | Partly | Needs Lachy (can be caught at preflight) |
| 9 | Login billing refusal ("payment is past due", 2026-11-07 05:57Z to 22:33Z). Dead calls kept their Slots open, so it read as `lead-absent` (Monthly audit gap 2) | 32.0 | 2 (thread-skill-11-07 16.0, giflab-11-07 16.0) | [[thread-skill-p46-3-an-allowance-refusal-is-its-own-outcome]] | No (scheduled) | Needs Lachy to pay; the stop's labelling could resolve itself with p46-3 |
| 10 | git-env trips: in-place peer commits (agent-stable-10-18), the lead's unarmed record (chorus-10-18), a space-named task note (chorus-11-02, "Chorus multi-photo import workflow", 11.75 h) | 30.8 | 3 | p26-2 (every rollout runs from its clone, live); p29-2 (live); [[thread-skill-p47-6-a-space-named-note-halts-a-rollout]] | Partly (p47-6 scheduled) | Could resolve itself with a change |
| 11 | merge-task waits forever on a CI job no runner takes and no rule requires (compression-engine's self-hosted `alpine`), under a protection that requires no checks. `infra` retries repeat the wait | 23.4 | 3 (compression-engine-11-08 18.3) | 9ae5d7f (merge an UNSTABLE PR; merged 11-08, after that rollout's engine snapshot bf3ed049 was cut); P43-4 (a cancelled check reads as a CI timeout, 11-09); #370 (no-runner, required jobs only, 11-11); open: [[thread-skill-p47-3-merge-task-unstable-guard-follow-ups]], [[thread-skill-bug-merge-task-protected-no-required-checks]], [[thread-skill-merge-task-empty-required-checks-reads-as-some]], [[thread-skill-p47-2-a-repeat-stall-frees-the-lane-and-keeps-its-diagnosis]], [[compression-engine-ci-and-test-debt]] (retire `alpine`) | Partly | Could resolve itself with a change |
| 12 | Hand-back waits. Thread-skill-11-06: two set-asides overnight (7.6 h). Thread-skill-11-08: "nothing can start: 0 set aside", a dependency on chorus-p100-8 that was left out of its queue (5.7 h). Chorus-11-04: a merge-task set-aside with no mover (7.75 h) | 21.2 | 3 | ADR 0078 d7 / p45-5 (nothing is left out silently, merged 11-11); p47-2 and p47-3 for the merge-task stop | Live, not yet proven | Mixed: the overnight set-asides need Lachy; the other two could resolve themselves with a change |
| 13 | Verify-slot waits (load) | 20.4 | 27 | By design (verify-slot) | Yes | Resolves itself today |
| 14 | Integration rework (conflict, red, reject; 9.2 h), merge-gate red after verify (4.9 h) and re-run integration suites (8.7 h) | 22.8 | 16 | ADR 0068 (schedule reads the merge gate) | Yes | Resolves itself today |
| 15 | Mac sleep while a rollout ran | 12.2 | 15 (thread-skill-11-10 8.3) | chorus-p70-3 keep-awake (live; a closed lid still wins) | Yes | Needs Lachy (the lid); resumes on wake |
| 16 | Room stops at a usage limit: 3.1 h recorded, plus 30.8 h found unrecorded before 2026-11-03 (Monthly audit gap 1) | 3.1 (+30.8) | 3 recorded, 11 before | Stop driver and quota hold (p36-7) | Yes | Resolves itself today |

Not stalls, kept for scale (the ledger's `other`):

- **Lachy's own pauses: 46.3 h.** Of these, 21.3 h is `animately-app-rollout-2026-11-07`'s hard pause "until
  [[thread-skill-merge-task-empty-required-checks-reads-as-some]] lands", which is Monthly audit gap 7. A durable trigger, ADR 0078 d5 (p45-7,
  merged 11-11), now carries that kind of wait.
- **Dependency waits: 50.4 h.** smart-slider-10-28 30.6 h and thread-skill-10-26 15.9 h. This is queue order.

### What changed over the month (lane holds over 30 minutes, hours)

| Week starting | A stuck check | B halt | C merge-gate | D lead stopped | E CI in lane | F rework | G work |
|---|---|---|---|---|---|---|---|
| 13 Oct | 0 | 18.0 | 0 | 97.3 | 0 | 1.8 | 23.1 |
| 20 Oct | 0 | 4.2 | 0 | 38.2 | 0.5 | 2.2 | 9.7 |
| 27 Oct | 3.2 | 7.8 | 0 | 37.9 | 9.9 | 3.8 | 13.0 |
| 3 to 12 Nov | 20.3 | 1.3 | 4.9 | 3.0 | 60.9 | 1.4 | 8.4 |

Before 3 November, the lane was held mostly while its lead was not running. Since then it is held by CI: Thread Skill's
own CI, and one job that no runner took.

## Why compression-engine-rollout-2026-11-08 scored `none-clear`

Re-scored with `score.py --rollout compression-engine-rollout-2026-11-08 --until 2026-11-09T03:08:42.519Z`, which
gives the close line's numbers again. No rule in score.py's Binding held:

- **Lane-bound needs the lane busy for at least 80% of running time. It read 71%.** The lane was held for 18.8 h in
  total, all of it lane-only: no Slot was open. But running time counts a lane-only stretch for at most
  `LANE_ONLY_CAP` (2 h). Each of the four 4-hour merge-task waits therefore lost its last 2 h, 7.9 h in all
  (`lane-only-over-cap`), from running time and from lane busy time together. That left 10.96 busy hours out of
  15.36 running hours. Counted in full, the share is 18.8 / 23.2 = 81%, and the rule holds.
- **Waits climbing did not hold either, because the stall came first.** The ready-to-lane waits were 215, 163 and
  204 minutes in the first third of the run and 0.2 minutes in the last third. The rule only looks for waits that
  grow.
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

- **Resolves itself today:** 1 (except the mislabel), 4, 5, 13, 14, 16.
- **Could resolve itself with a change:** 3 (P49, p47-9, p47-10), 6 (p47-2), 10 (p47-6), 11 (p47-2, p47-3 and the
  two merge-task bug tasks, compression-engine-ci-and-test-debt), 12 (p47-2, p47-3), 2 (p47-13, partly). Also the
  scoring and labelling faults: the ledger task, the score task, and the engine-snapshot task.
- **Needs Lachy:** 7 (questions), 8 (gates, which preflight can catch), 9 (billing), 15 (the lid), and the overnight
  set-asides in 12.

[[thread-skill-grill-rollouts-resolve-themselves]] took this audit as its input. It was grilled at the
2026-11-12 orient (ADR 0080: any merge setting may change), so the rows above that point at p47-9 follow that ruling.
