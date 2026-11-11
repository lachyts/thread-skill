# 0078 — A fix is done when the stuck work moves, and nothing it needs rests on one session

Date: 2026-11-09
Status: proposed; d6 built by p45-6. Grilled with Lachy on 2026-11-09 (`/grill-with-docs`, thread-skill session), after an audit of why
the Waiting list work (ADR 0076) and its fixes did not turn out as he expected. Sharpens the **Landing** ADR 0028 promises
("agents own it end to end"), amends ADR 0066 (a diverged Primary checkout is repaired, not only recorded) and ADR 0067
d7 (a second schedule for a running rollout joins its queue).

## Context

On 2026-11-09 Lachy asked whether the features to restart his stuck chains were built. They were landed, and none
were live:

- **Built was not live.** The Primary checkout, the copy every session loads the plugin from, had diverged on
  2026-11-07 (ahead 5, behind 53, later 6 and 54). Each `/thread:close` commits its close-out on the Primary's
  current branch, then `land.sh` pushes a `close/…` branch and queues an auto-merge PR, "no waiting for a merge". Seven
  such PRs (#292, #293, #312, #330, #331, #337, #339) sat unmerged back to 2026-11-04: close-outs all edit THREAD.md so
  they conflict (DIRTY), and the `master-green-pr-only` ruleset's strict up-to-date rule, with 25–45 min CI and a busy
  master, leaves them behind. Nothing kept them current. The local commits stayed, the Primary refresh correctly
  refused to merge a diverged checkout, and its only trace was a state file: ADR 0075 d2 removed its notice and nobody
  ran `/thread:status`. P41, P42, P43 and P44-1/2 were landed and not live for two days. A close-out at 18:31 the same
  day repeated it.
- **Fixes waited behind the queue they fixed.** P41/P42 (grilled 2026-11-07) and P44 (2026-11-08) fix stuck rollouts
  and ship through rollouts. Joining a running rollout takes a pause, a drain and a regenerate, hours each time; it was
  done twice (thread-skill, Chorus). Chorus's 2026-11-09 orient left [[chorus-p100-8-the-stage-starts-chains-from-the-waiting-list]]
  out of its queue without listing it, though thread-skill's P44-4 depended on it.
- **Follow-through rested on one session.** Every "when this lands, do that" step lived in the grill session's
  background watchers, which stop at two hours and ended when the Stage let the process go; steps were handed to other
  leads by relay.
- **Nobody could tidy the Stage.** The Companion stops only running work, the Stage keeps a halted Leg session, and
  its close route answers only its own page.

Lachy: "a bunch of things seem like they happened here where I expected a different outcome … how we can make this
more robust in the future (and how we can preempt the problems that you just came across)."

## Decision

**d1. Done means Proven.** A fix is done only when what it was filed to clear (a stuck rollout or chain, a failing
behaviour) has been seen to move with the fix Live (CONTEXT.md **Landed**, **Live**, **Proven**). Until then it is a
**Carried fix**, and he is never told it is done. A task filed to clear nothing in particular is done once live.
(Lachy's pick, 2026-11-09: "The stuck work moved".)

**d2. A landing is carried until it merges.** Every landing PR, a close-out's or a session's own branch, has an owner
that keeps it moving: brought current whenever it is behind and its checks are green, its THREAD.md and handoff
conflicts resolved mechanically (THREAD.md's Session log and learnings only grow, so both sides are kept, newest first),
its CI retried as ADR 0069 retries a GitHub stop, and an earlier landing that a later one carries closed as superseded.
One that cannot be moved within a day is a stop the Companion leads him to.

**d3. Nothing commits on the Primary checkout.** `land.sh` commits a close-out on a `close/…` branch cut from origin's
default branch in a scratch worktree, never on the Primary's default branch, and the Primary only ever fast-forwards. A
guard refuses a commit on the Primary's default branch. A grill's CONTEXT.md and ADR edits made in place stay
uncommitted there and land from a branch the same way.

**d4. A diverged Primary is repaired, and shown.** The Primary refresh repairs `diverged` instead of only recording it:
when every local-only commit's change is already on origin it resets the Primary to origin, keeping a backup ref;
otherwise it carries those commits to a landing branch (d2). Its state is on the quiet Stage line (current, or "N fixes
landed, not live"), and one unrepaired for a day is a stop the Companion leads him to. (Lachy's pick, 2026-11-09:
"Self-repair, quiet line".)

**d5. A wait with a follow-up step lives in the system, never only in a session.** "When this rollout is paused,
regenerate it with X", "when PR N merges, reset the Primary" and "when task T in another repo lands, schedule U" are
written on the rollout or task note as durable triggers that the engine and the Stage act on, as the Approved queue's
`hold_until` and `on_merge` already do for one case. No session's background watcher is a step's only owner.

**d6. A fix that other stuck work needs joins a running queue in place.** A task that unblocks other rollouts (a fix to
the rollout machinery, or another repo's dependency) joins the running rollout of its repo and project, ranked first,
with no pause and no regenerate: ADR 0067 d7's "it joins that one queue" made real.

**d7. Nothing is left out silently.** Orient, orient-all and schedule list every task they leave out of a rollout with
its reason. A task another project's work depends on is scheduled, or every dependant's rollout note says what it
waits on and where.

**d8. Idle Leg sessions are tidied by the Stage** (added to [[chorus-p100-8-the-stage-starts-chains-from-the-waiting-list]]):
a Leg session whose Leg has closed, never opened, or lost its chain copy is archived at its Turn's end.

## Considered options

- **Bring the Primary-refresh notice back**: rejected. Rollouts never notify (ADR 0075 d2, his rule of 2026-11-07); the
  system repairs, and the quiet line shows it.
- **Merge a diverged Primary in place**: rejected, as ADR 0066 rejected it: it integrates under live sessions. A reset
  happens only when every local commit's change is already on origin.
- **Keep closing a fix at merge** (today's rule): rejected by his pick. It is how P41/P42 read as done while nothing
  moved.

## Consequences

- One-off, now: once lachyts/thread-skill#358 merges, the close-out PRs it carries (#330, #331, #337, #339) are closed as
  superseded, the 18:31 close-out (3190909) is carried to a landing branch, and the Primary is reset to origin.
- THREAD.md stops being a merge-conflict magnet only once d2's mechanical resolution exists; until then each close-out
  PR is checked by hand at the next sitting of this repo.
- The checks the d1 rule needs ("did the stuck work move?") are written on each fix task when it is filed: a fix names
  what it clears and how that is seen.

## Decided for Lachy (overturnable)

1. Close-outs commit on a branch in a scratch worktree and a guard refuses commits on the Primary's default branch:
   the in-place commit is the root of the frozen plugin. (technical)
2. A landing PR's owner brings it current, resolves THREAD.md by keeping both sides, retries CI and closes superseded
   ones: the ruleset's strict up-to-date rule stays, since it keeps master green. (technical)
3. A diverged Primary resets to origin only when its local commits' changes are all on origin, with a backup ref;
   otherwise its commits are carried to a landing. (technical)
4. Follow-up steps are durable triggers on notes, extending the Approved queue's form rather than a new store.
   (technical)
5. A fix other stuck work needs joins the running queue first in line, without a pause. (priorities: get rollouts
   started; quality over speed)
6. Orient and schedule list every left-out task with its reason, and never drop a cross-repo dependency silently.
   (technical)
