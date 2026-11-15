---
thread: thread-skill
written: 2026-11-16
status: pending
---

**Run from:** `/Users/lachlants/repos/tools/thread-skill`

# Handoff: the merge wait on thread-skill (suite audit, then the fix)

Lachy's ruling, 2026-11-16, asked which cost to take on next now that the limit is fixed: "The merge wait
(Recommended)", with the note "let's do that. And maybe do it as a /thread:handoff". This doc briefs the session that
does it.

## 1. Done and verified

The session before this one audited why the three live rollouts were slow, grilled the fix with Lachy and got it
built. None of it needs redoing.

- **The audit (2026-11-15).** The Mac-wide limit (Capacity) read 1 for 57.6 hours: a memory warning froze it, and the
  warning came from `fseventsd` (86 GB of 96), not from the rollouts. Recorded in
  `docs/adr/0083-capacity-backs-off-only-for-strain-it-can-relieve.md` (PR #406, merged), with CONTEXT.md's
  **Strain**, **Mac fault** and **Weight**.
- **Chorus Phase 109, all 8 tasks landed** (lachyts/chorus #793 to #800, by 2026-11-16 05:06). Live on the Stage
  since its 00:13 start: #793 to #795 (whose memory it is, Capacity yields to Strain only, the Lunch restart reads its
  admin rule properly). Proof: from 00:13 to 02:55 the memory warning stood with `fseventsd` at 98 GB and Capacity
  rose 1 to 6 (`capacity` lines in `~/.local/state/chorus/stage/companion.jsonl`; `~/.local/state/chorus/stage/signals.jsonl`).
- **The reset trial passed** (02:51 to 03:05, inside chorus-p109-5): `sudo -n /usr/bin/killall fseventsd` freed it,
  nothing needed relaunching. Written under `## Trial` in
  `~/repos/obsidian/Work/Phases/chorus-p109-capacity-tells-strain-from-a-mac-fault-and-repairs-it.md`. Five hours on,
  the new `fseventsd` held 3.5 MB under busy rollouts, so steady rollout file churn does not look like the cause.
- **The admin rule is installed** (`/etc/sudoers.d/chorus-restart`: the restart and the two `fseventsd` resets).
- **Thread Skill Phase 53:** p53-1 to p53-3 landed (#408, #409, #410). p53-4 (PR #411) is approved and in
  Integration since 06:40; both its checks had passed by 08:15. p53-5 starts after it.
- **The strict hold.** On Lachy's word, 33 older queued tasks of `thread-skill-rollout-2026-11-12` carry
  `depends-on: [[thread-skill-p53-5-the-reflection-reads-and-tunes-the-budget]]` and start by themselves once it
  lands. Chorus's hold released by itself at 05:06. Both rollout notes say so under `## Notes`.

## 2. What remains

In order:

1. **Run the `suite-audit` skill on this repo**: its test suite and its required merge checks. The numbers that
   prompted it:
   - Required checks are `make test` on ubuntu-latest and macos-latest. On PR #411 the ubuntu job ran 41 min 29 s and
     the macOS job 29 min 44 s, yet the PR waited about 95 minutes from its push (06:34) to both green: separate
     runner queue time from run time (`gh run list`, `gh run view --json jobs`).
   - Recent runs took 43 to 107 minutes end to end (p53-2: 43 min; p53-3: 51 min, then 107 min). #411's first run was
     cancelled after 55 minutes (see #405, "a test step cut at the job's time limit is retried once").
   - Overnight, a thread-skill task waited a median 0.9 h between its Slot freeing and its merge; a Chorus task 0.1 h.
   - Last week's Time-lost ledger (`~/repos/workspaces/_shared/state/thread-events/reflections.jsonl`, the 11-02 to
     11-09 reading): Integration lane 96.1 h, second to stalls at 114.5 h.
   - ADR 0073 made `make test-fast` the Verifier at Integration, with `make test` as the Completion verifier, but the
     required GitHub checks still run the full suite on two runners for every PR.
2. **Turn the audit's report into a phase** (Phase 54, `/thread:orient docs/audits/<its report>`), tasks at
   `priority: high`, and schedule it. The rollout is running, so the schedule joins it.
   - Before scheduling, keep the strict hold from catching the new tasks: add the new phase's prefix to `NEW` in
     `.scratch/p53-p109/hold.py`, or skip this if p53-5 has landed by then (the hold has released itself).
3. **Small checks left from the Capacity work**, each a read, none blocking:
   - After the Stage next restarts (the Lunch restart, about 13:45 on 2026-11-16 if he is away from the keyboard),
     `~/.config/thread/capacity.json` should carry `budget`, `~/.config/thread/slot-peaks.json` should exist, and the
     Stage's quiet line should show a fault when one stands. Five Chorus merges (#796 to #800) are not live until then.
   - When p53-5 lands, confirm the 33 held tasks start with no hand in it (`reconcile-rollout.py next --dry-run` from
     the rollout's engine root shows no `depends on [[thread-skill-p53-5…]]` rows).
   - ADR 0083's Decided for Lachy 15 asked for `fseventsd`'s regrowth to be read before the clones change: the
     reading above (no regrowth in five hours) belongs on the ADR when p53-5 sets it accepted.

## 3. Decisions settled

- **The next focus is the merge wait**, ahead of stalls, rejected plans and watching for a week (Lachy, 2026-11-16).
- **Capacity's four rulings** are in ADR 0083 with his words; do not reopen them.
- **Everything else waits for all of Phase 53** in the thread-skill rollout (Lachy, 2026-11-15, asked three times:
  "stop the rollouts and do this work as a priority"). When he asks twice for focus, build the stop.
- **He did not want the Stage restarted under him**: the Lunch restart brings the five Chorus merges live.
- **Rollouts never notify him**; a stopped rollout shows on the Stage (ADR 0075).

## 4. Gotchas found the hard way

- **Do not run the full suite while he is at the Mac.** Offer `wait_for_away`, or take the timings from CI's own runs.
  On 2026-11-15 this session's checks added to a load that cut the limit.
- **`sudo -n -l <command>` exits 0 for any command on this Mac** (`(ALL) ALL` plus an unrelated NOPASSWD rule). Read
  the listing's `NOPASSWD:` entries instead. chorus-p109-3 fixed the Stage's own copy of this mistake.
- **A Chorus merge is not live until the Stage restarts.** Check the Stage's start time
  (`launchctl print gui/$(id -u)/com.lachy.chorus-stage`) against the merge before calling a fix live.
- **The primary checkout is the live plugin.** Docs and code land from a worktree branch by PR, never in place.
  `tests/contracts/refs.test.mjs` reads a bare "ADR NNNN" as this repo's: write "Chorus ADR NNNN" for Chorus's.
- **A hold that releases itself is a `depends-on:`** on the work's final task, written through the engine's `Note`
  (`Note.apply` then `Note.save`). A pause stops the new work too and only restarts by hand; a rollout whose every
  row is dependency-held with nothing in flight halts `stuck`.
- **`hold.py` and `held.json` are untracked**, in `.scratch/p53-p109/` of the primary checkout. `hold.py release`
  lifts the hold early; `hold.py show` lists it.
- **Background work ends with the session**: the reset trial this session queued for his Away never ran here; the
  Chorus task ran it.

## 5. Suggested skills

`suite-audit` (the audit), `thread:orient` on its report, `thread:schedule`, `writing-lean-tests` for any test the
fix touches, `thread:status` to read the rollout.

## 6. Paste-ready prompt

```
You're continuing "The merge wait on thread-skill: suite audit, then the fix" mid-stream — a live handoff, not a cold pickup.
Run from: /Users/lachlants/repos/tools/thread-skill — launch the session there; a cd from another launch directory is reset.
Read first: /Users/lachlants/repos/tools/thread-skill/docs/handoffs/2026-11-16-merge-wait-suite-audit.md (absolute path) — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: The Capacity fix (ADR 0083) is built: Chorus Phase 109 landed whole, thread-skill Phase 53 is at task 4 of 5, and 33 older tasks are held until task 5 lands. Lachy ruled the next focus is the merge wait: thread-skill PRs wait 45 to 110 minutes on two required `make test` checks, against about six minutes on Chorus. Last week the Integration lane cost 96 hours.
Also read: docs/adr/0073-thread-skill-verifies-a-fast-tier-at-merge.md, docs/adr/0083-capacity-backs-off-only-for-strain-it-can-relieve.md, CLAUDE.md § Tests, .github/workflows/, ~/repos/obsidian/Work/Tasks/thread-skill-rollout-2026-11-12.md § Notes
Suggested skills: suite-audit, then thread:orient on its report, then thread:schedule; writing-lean-tests
Gates: any change to what a pull request must pass before it merges (dropping the macOS check, making a required check run the fast tier, moving the full suite off the merge path) returns to Lachy via grill-me with the audit's numbers — report the fork and its evidence, do not resolve it downstream. He steers when a landing blocks (the project's Priorities card).
Next move: run the suite-audit skill on ~/repos/tools/thread-skill, taking run and queue times from CI's recent runs (gh run list / gh run view --json jobs) first; offer wait_for_away before any timed full run on this Mac.
```
