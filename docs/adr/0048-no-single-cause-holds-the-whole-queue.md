# 0048 — No single cause holds the whole queue

Date: 2026-10-21
Status: accepted. Ruled with Lachy in the re-grill of PR #202, after the audit of where rollout time went (§ Context). Generalises ADR 0046 (a git-env trip holds only the lane) and ADR 0034 (a gate sets its task aside, never halts the rollout). Built by p29-7 (2026-10-28). Amends ADR 0030 (merge-task 2/70 halts) and ADR 0033 (an invalid budget stamp; a cool-down over an UNVERIFIED task).

## Context

From September to 21 October about 150 to 185 hours of rollout time went to stalls, usage limits and machine load, against about 35 to 50 hours of real merge time in the Integration lane. The largest share was overnight stalls: the whole queue waiting until morning on one thing. Each was fixed for its own cause, and a new cause appeared about weekly: a bypass-proof `rm` prompt (13 hours), the lead's own question (12), a `paused:` stamp and a spend gate (17 and 14), a 03:10 restart, a false git-env trip (15), a plan-size ruling (6). Lachy's standing rule already says an unattended rollout acts on its lead's recommendation and never blocks on a question; ADR 0034 applies it to gates.

## Decision

**No single cause may hold a whole rollout. A hold covers the smallest thing it threatens, and a stall no hold explains is caught from outside the session.**

- **Scope every hold.** A cause that threatens one task sets that task aside; one that threatens merging holds the Integration lane; only a cause that threatens every task (a settings file every entry refuses, say) may hold the whole rollout. A task waiting on Lachy is set aside, never a held queue, and the rest runs on; a hold that protects `main` or every task (ADR 0046) waits on him at its own scope. A pause is Lachy's own act and stays whole-rollout.
- **Catch what is not a hold.** A dead lead, a dead session, a Mac restart and a usage limit hold nothing; they simply stop. A watchdog outside the rollout's session notices a rollout with work pending and nothing moving. It has two layers. thread-skill ships the reading: whether a rollout is moving, read from its Run record and notes and carried in `/thread:status`'s Situational report. Chorus's Companion polls that reading and acts on it, since it already sees every Session, spreads rollouts across Logins and carries on a failed turn. When Chorus is not running, a launchd job reads it instead and only notifies Lachy.
- **The Companion recovers first.** Every mechanical recovery is its own to do without asking: resuming the lead, moving it to a Login with headroom, a cold resume after a restart, `/thread:repair` for a block an agent may clear. It notifies Lachy only when a recovery fails twice or what is left is a decision. The engine keeps sole merge authority (ADR 0004); the Companion only restarts the engine.

## Considered options

- **Per-cause fixes, as before:** rejected. Each fix closed its cause and the next cause cost another night.
- **A watchdog only, holds left as they are:** rejected. It would wake Lachy for holds that need no one.
- **The watchdog in one place:** rejected. The Companion alone leaves rollouts run outside Chorus unwatched; a launchd job alone cannot see Sessions or switch Logins. The rollout's own heartbeat cannot be it: it runs inside the session that stopped.
- **Scoped holds only, no watchdog:** rejected. The stops that are not holds (limits, restarts, a dead lead) were a large share of the loss.

## Consequences

- Every whole-rollout halt in execute must justify itself against the first bullet, or narrow.
- Amended by ADR 0060: the kept halts gain `surface held: [[<chain>]] writes <token>` and `surface re-check failed` (execute § 4.5's *Surface re-check*). A parallel rollout that released its Project root while it waited finds a chain on it on resume, and every task writes that root, so it halts whole until the chain lands its rows there.
- Every stop and every resume lands in the Run record, whatever caused it, so a Reflection can price it (ADR 0051).
- Which Login a recovered lead moves to, and how rollouts spread across Logins, stay Chorus's (its Login-spread task); thread-skill decides nothing about Logins.

## How p29-7 built it

- **The reading.** `reconcile-rollout.py moving` is the Watchdog's verdict: moving, stalled, a meant wait with its
  cause, or skip, read-only and guard-exempt, from the Run record's life signs and `next`'s own dry run. Its algorithm's
  one copy is reconcile-rollout.py's module docstring; the safety wording (what `stalled` means, and that it never by
  itself starts a second lead) and *Which waits silence judges* are status SKILL.md § The Watchdog's reading. A wait
  only the lead's own heartbeat ends (a merge hold) is judged by silence, as is the lane the lead holds for a RACE
  re-verify (a re-verify in flight never halts on its own task); one `next` or the clock reads live (a cool-down, the
  Trickle, the Away cap, the Heat hold, the last starts, a PR hold) by its own condition.
- **The Lane hold.** merge-task's abort (70) and its environment exit 2, every `lead-integrate.py` exit 2 on the task
  that holds the lane, and the Integration verify's third `noslot` write one `## Lane log` line (`lane-hold`), which
  `next` reads into `laneHold` and halts `lane` on once nothing else moves; a `lane-hold` that cannot write halts the
  whole rollout (`lane hold not written on [[…]]`), since the rollout note every task shares cannot carry it; only
  Lachy's ack through `/thread:repair` (`lane-ack`) releases it, and until then `carry` refuses the rollout, since a
  carry strips `integrating:` and never copies the `## Lane log`.
- **The wait clauses.** Execute § 4.5 step 1.5 reads a cool-down, a cap-held seeded revise and (for the lane arms) a
  `waits: merge` PR hold before a lane verdict, `stuck` or a task-scope hold goes to § 7: a wait `next` cannot see
  never becomes a halt.
- **lead-integrate's exit 2, by verb and site.** On the task that holds the lane it is a Lane hold; a note race on a task
  that holds no lane (`task note unreadable:`) touches only that task this turn; `revert`'s exit 2 and a malformed
  re-entry command stay whole.
- **The kept and narrowed lists.** Execute § 7 lists every whole-rollout halt kept with its reason, and every halt
  narrowed with the site that now holds less; `moving`'s WHOLE_HALT_PATTERNS is bound to the kept list by a contract
  test.
- **The retry classes.** `prepare: origin unreachable three times` and `merge-task signalled twice` retry as `infra`;
  `merge-task exit 8 three times` stays `agent`.
- **prepare's task-scoped set-aside.** A failure that threatens only the task (its anchor, its worktree, its anchor
  ref) routes `set-aside`, exit 0; the environment's stays exit 2, the Lane hold.
- **The regenerate bound.** Under `halt: regenerate` the Approved-queue route runs one foreground turn with no life
  sign, so `moving` judges it at 120 minutes from the last life sign, in place of the 45-minute default.
- **The launchd fallback.** `watchdog.py check` reads the same verdict when Chorus is not running and only notifies,
  once per stall, through `ntfy-push.py`. It probes the Stage as `ctl.sh status` does (`api/logins`), never through
  `host.lock`. Until the Chorus task that consumes `moving` lands, a running Stage silences the fallback, so a stall
  then goes unnotified (*The interim gap*); `watchdog.py plist --chorus-url ''` installs one that never probes.
