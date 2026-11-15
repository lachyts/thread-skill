# 0083 — Capacity backs off only for strain it can relieve, and by day it protects his Mac

Date: 2026-11-15
Status: proposed. In grill with Lachy (`/grill-with-docs`, 2026-11-15); the decisions below are added as he rules
them, and the open questions are listed at the end. Amends ADR 0067 d8 (Capacity is the limit, set automatically) and,
through it, Chorus ADR 0104. Nothing here is built.

## Context

Lachy asked for an audit of why the three live rollouts (`thread-skill-rollout-2026-11-12`,
`chorus-rollout-2026-11-12`, `narcissus-avp-rollout-2026-11-13`) were slow, whether "the cap of 4" was too small, and
whether the number could scale with the nature of the tasks and the resources they use.

The audit (three read-only readers, 2026-11-15 09:10) found the cap of 4 was not the limit:

- **Capacity read 1 for 57.6 hours**, from 2026-11-13 04:14 to 11-15 13:50 (about 53 hours in at the audit). 59 of the three rollouts' 79 Slot starts ran
  under a cap of 1, and since all three overlapped the Mac ran exactly one task at a time for 34.5 of 37.8 hours. The
  hold cost about 120 rollout-hours (`hold-away-cap` 92.7 h, `hold-trickle` 26.6 h); 4 tasks at once happened for 3.4
  hours, all on the first day.
- **A memory warning froze it, and the rollouts did not cause the warning.** macOS's file-events daemon
  (`fseventsd`) held 86 GB of the Mac's 96 GB (68 GB of it compressed), with swap 46 of 47 GB used, after 11 days up.
  The three rollouts together held about 2.4 GB, his own apps 15 to 25 GB. Running fewer tasks never lifted the
  warning: it cleared only on 11-15 at 13:40, when Chorus's Lunch restart quit his apps, with `fseventsd` still at
  88 GB and swap still full, so it can return at any time. The likeliest cause is file churn from 12 rollout clones;
  it is not proven.
- **A restart of the Mac already exists and has never run.** Chorus's Lunch restart (Chorus ADR 0101,
  `src/stage/lunch_restart.py`) quiets the Stage, asks his apps to quit and restarts the Mac weekly, but its admin
  rule (`/etc/sudoers.d/chorus-restart`) was never installed, which is how the Mac reached 11 days up. On 11-15 it
  quit his apps at 13:40 and was then refused at 13:45 ("sudo: a password is required").
- **Nobody was told.** The freeze surfaced only because he noticed the rollouts were slow.
- **Before the freeze (11-05 to 11-12)** Capacity moved between 1 and 4 by day, halved 45 times, 39 of them by load,
  with nothing recording whose load it was. Away it sat at 6 for 90.8 hours and was seldom filled: about 149 hours
  had room nobody used. That week's Time-lost ledger put the cap's holds at about 28 of 252 hours lost, behind stalls
  (114.5 h) and the Integration lane (96.1 h).
- **A task's weight varies.** A notes or script task measured about 0.8 GB; a full suite and an Xcode build were
  estimated at 1 to 3 GB and 4 to 8 GB with several cores. Capacity counts each as one.

So the limit already scales with the Mac's signals (ADR 0067 d8). What it lacks: it cannot tell whose strain it reads,
nothing repairs or raises a limit that is stuck, and it counts tasks rather than their weight.

## Decision

1. **By day Capacity protects his use of the Mac; Away it protects only the Rollouts.** While he is not Away,
   Capacity backs off for strain whoever causes it, his own apps included, so the Mac stays responsive for him. While
   he is Away it backs off only for strain the Rollouts themselves cause. Ruled by Lachy 2026-11-15: "A by day, B
   while Away".

2. **Under both, Capacity backs off only for strain that fewer tasks can relieve.** Strain that running fewer tasks
   cannot lift (this week's 86 GB daemon) never lowers Capacity and never freezes it; it is a fault to repair, not a
   load to yield to. Put to him with decision 1 as "one rule under both" and not overturned.

3. **The Companion repairs a Mac fault itself: a system process at any hour, the whole Mac just before 7:00.**
   Ruled by Lachy 2026-11-15, choosing the widest reach offered ("Also restart the Mac while Away"), then, told that
   FileVault leaves a restarted Mac at the login screen until he types his password: "Yes to the restart just before
   morning but I would say that should happen at just before 7:00 rather than 9:00. There are times when I'll start
   work at 7:00 so let's make it at 7:00."
   - It may restart a misbehaving macOS background process from a short approved list at any time, Away or not.
   - A fault that outlives that reset gets a restart of the whole Mac just before 7:00, whatever the Morning's hour,
     so the Mac waits locked only briefly. No password of his is stored, and no restart happens at any other hour.
   - Outside that restart it never closes his apps; the restart asks them to quit politely, as the Lunch restart
     does. Anything else it shows on the Stage and leads him to when he is at the Mac.

4. **Capacity counts Weight, not tasks, from the first build.** A notes task and an Xcode build stop counting the
   same: each task carries a Weight, what it is expected to use at its heaviest, and Capacity is the room the
   Rollouts may fill with it. Ruled by Lachy 2026-11-15, offered "fix now, measure, then weigh" as the recommended
   path: "Build it all now": the fix and the Weights together, starting Weights estimated by kind and corrected as
   measurements arrive.

## Decided for Lachy

Technical calls made in his place, each his to overturn. Under decision 3:

1. **The process reset comes first, the restart only if the fault outlives it.** The restart costs him his open
   apps; the reset costs nothing he sees.
2. **The restart is the polite kind: an app holding unsaved work stops it, and it is never forced.** Unsaved work
   cannot be got back, and under decision 2 a fault no longer lowers Capacity, so a missed restart costs little. A
   stopped restart shows on the Stage and waits for him. It is the Lunch restart's own drain, polite quit, restart
   and resume, reused (Chorus ADR 0101), and it checks that it may restart before it asks any app to quit.
3. **The restart starts at 06:30, after the Rollouts have drained, at most once a night, and only while a fault
   stands.** Half an hour covers the drain and the boot before a 7:00 start.
4. **The approved list starts with `fseventsd` alone.** It is the one process the audit caught; a name joins the
   list only by a recorded decision.
5. **The admin permission is one narrow rule naming those restarts and nothing else**, set up once by him
   (`/etc/sudoers.d/chorus-restart`). Installing it also arms the weekly Lunch restart, as ADR 0101 designed.
6. **Every repair is logged and shows on the Stage's quiet line** (Chorus ADR 0122), never as a notification
   (ADR 0075).

Under decisions 1, 2 and 4:

7. **Weight has two parts, memory and cores.** By day Capacity was cut for load 39 times of 45, and this week for
   memory; one number would hide which of the two is short.
8. **A starting Weight comes from the task's repo**, as a setting, else a built-in middle value of 3 GB and 2
   cores. A task note has no field that says what it runs (`scope:` holds single-file, cross-cutting or read-only),
   and a repo's tasks share its verifier: about 1 GB and 1 core where it runs scripts, 8 GB and 4 cores for an Xcode
   or simulator build. These are the audit's measures and estimates.
9. **A measured Weight replaces the estimate once its project and `scope:` have three past runs**, the Last
   starts' threshold: each Slot's process tree is sampled while it runs, and a script writes its peak to the Run
   record, which is where the measure is read from (the Last starts read call journals, which hold no peak).
10. **Chorus measures and thread-skill decides**, as ADR 0067 d8 has it. The same samples say whose Strain a reading
    is (the Rollouts' trees, his apps, the rest), which decisions 1 and 2 need, and every cut records it.
11. **Capacity becomes a budget of memory and cores.** A start fits when the running Weights and its own are inside
    the budget. The controller keeps its shape: the budget grows while the Mac is green and is cut on Strain. One task
    always fits Mac-wide, as today's floor of 1 does; heat, quota and the fair share may still hold a rollout.
12. **A memory warning is Strain only as far as the Rollouts hold the memory.** Where stopping every Rollout task
    would not clear it, it is a Mac fault. The plan sets the line between the two. The same holds for a running
    suite and a restart: `stop_suites` and the restart hold follow Strain, never a fault.
13. **The day target of 4 becomes the budget's starting size** (four mid-weight tasks), and `capacity_max` stays 6 as
    a hard count behind it. Away, 6 was reached for only 10.6 hours in two weeks; a Reflection raises either when the
    Run record shows it binding on a green Mac.
14. **With no fresh reading the fallback still counts tasks**: the Trickle and the Away cap, as today, never open.
15. **`fseventsd`'s regrowth is measured before the clones change.** If it tracks Rollout activity after the Mac's next
    restart, cutting the clones' file churn is its own task.
16. **This ADR stays on the limit.** Stalls and the Integration lane cost more hours than the limit did, and the
    weekly Reflection's Time-lost ledger already ranks them (ADR 0051).

## Consequences

- Chorus records the matching change against its ADR 0104, and builds the measuring, the repair and the quiet line.
- "Suites slowing against their median" (`chorus-capacity-reads-suites-slowing`) stays a separate, unbuilt signal.
- The Run record gains each Slot's measured peak and each cut's cause, so a reading of them holds only its window's
  rows (CLAUDE.md, Review rule).
- The first weeks run on estimated Weights, which may admit too many or too few tasks until measures replace them.
