# 0048 — No single cause holds the whole queue

Date: 2026-10-21
Status: accepted. Ruled with Lachy in the re-grill of PR #202, after an audit of where rollout time went. Generalises ADR 0046 (a git-env trip holds only the lane) and ADR 0034 (a gate sets its task aside, never halts the rollout).

## Context

From September to 21 October about 150 to 185 hours of rollout time went to stalls, usage limits and machine load, against about 35 to 50 hours of real merge time in the Integration lane. The largest share was overnight stalls: the whole queue waiting until morning on one thing. Each was fixed for its own cause, and a new cause appeared about weekly: a bypass-proof `rm` prompt (13 hours), the lead's own question (12), a `paused:` stamp and a spend gate (17 and 14), a 03:10 restart, a false git-env trip (15), a plan-size ruling (6). Lachy's standing rule already says an unattended rollout acts on its lead's recommendation and never blocks on a question.

## Decision

**No single cause may hold a whole rollout. A hold covers the smallest thing it threatens, and a stall no hold explains is caught from outside the session.**

- **Scope every hold.** A cause that threatens one task sets that task aside; one that threatens merging holds the Integration lane; only a cause that threatens every task (a settings file every entry refuses, say) may hold the whole rollout. A task waiting on Lachy is set aside, never a held queue, and the rest runs on; a hold that protects `main` or every task (ADR 0046) waits on him at its own scope. A pause is Lachy's own act and stays whole-rollout.
- **Catch what is not a hold.** A dead lead, a dead session, a Mac restart and a usage limit hold nothing; they simply stop. A watchdog outside the rollout's session notices a rollout with work pending and nothing moving. It has two layers. thread-skill ships the reading: a read-only verdict on whether a rollout is moving, from its Run record and notes. Chorus's Companion polls that verdict and acts on it, since it already sees every Session, spreads rollouts across Logins and carries on a failed turn. When Chorus is not running, a launchd job reads the same verdict and only notifies Lachy.
- **The Companion recovers first.** Every mechanical recovery is its own to do without asking: resuming the lead, moving it to a Login with headroom, a cold resume after a restart, `/thread:repair` for a block an agent may clear. It notifies Lachy only when a recovery fails twice or what is left is a decision. The engine keeps sole merge authority (ADR 0004); the Companion only restarts the engine.

## Considered options

- **Per-cause fixes, as before:** rejected. Each fix closed its cause and the next cause cost another night.
- **A watchdog only, holds left as they are:** rejected. It would wake Lachy for holds that need no one.
- **The watchdog in one place:** rejected. The Companion alone leaves rollouts run outside Chorus unwatched; a launchd job alone cannot see Sessions or switch Logins. The rollout's own heartbeat cannot be it: it runs inside the session that stopped.
- **Scoped holds only, no watchdog:** rejected. The stops that are not holds (limits, restarts, a dead lead) were a large share of the loss.

## Consequences

- Every whole-rollout halt in execute must justify itself against the first bullet, or narrow.
- Every stop and every resume lands in the Run record, whatever caused it, so a Reflection can price it; in `chorus-rollout-2026-10-18` three of nine usage-limit stops left no trace there.
- Which Login a recovered lead moves to, and how rollouts spread across Logins, stay Chorus's (its Login-spread task); thread-skill decides nothing about Logins.
