# 0074 — One serial chain per project, and sign-ins settled at schedule

Date: 2026-11-07
Status: proposed. Grilled 2026-11-07 in the SEO orient session, after its audit of `seo-rollout-2026-11-07` … `-4`;
built by Phase 42 (`thread-skill-p42-2` … `-4`). Amends ADR 0067 d4's "chains whose surfaces are disjoint run side by
side" for one project's serial work. Sits beside Phase 41 (a rollout waits instead of stopping, and never notifies):
this ADR moves the waits it can foresee into the sitting, where he is present.

## Context

`/thread:orient SEO` scheduled five serial-shaped rows: two live-site title/meta publishes, a content refresh, a
one-line edit in a second repo, and a new MCP fork. `serial-chains.py plan` groups members into chains by surface
overlap and in-set dependencies only, and each row claimed only its own task note, so it wrote four chain notes, and
the orient started four Leg Sessions at once. One finished (the fork). Two stopped within ten minutes on one cause:
the Webflow MCP, a remote OAuth server, was signed out in the Legs' Sessions; a thread note said it had been re-authed,
and nothing checked it from the Legs' launch before they started (only each Leg's own preflight, `legs.md` §
Preflight, sets such a row aside). The fourth stopped because a row that wrote `~/repos/tools/metrics` launched from
the workspaces seo launcher, a surface the orient added: its Leg made the edit, Verify was green, but a review
subagent cannot leave the Session's cwd (`legs.md` § Review), so the Leg reverted its own commit and set the task
aside. The plan refuses a cross-checkout row only when it has no launch alias.

His words: "it looks like you launched a bunch of rollout legs, like four different legs, and each of them failed in
different ways … Why then do we need to create four different serial chains that are each named 'leg'? It creates
all this extra admin especially when they break because basically all of these seem to break somehow."

His model of a rollout (one parent session, subagents under it) is the parallel shape. Serial work has no parent:
each chain is run by Legs, each a visible Session (ADR 0040). The admin he names is the count of those Sessions.

## Decision

**d1. One chain per project.** Schedule's serial path writes at most one chain note per project per run: every
serial-shaped member whose first `projects:` link is that project goes in it, in dependency order, and one Leg
Session works its rows in turn. A row set aside (a gate, a sign-in, a block) never holds the rows after it that do not
depend on it: the Leg sets it aside and claims the next, as `legs.md` already does. Disjoint surfaces no longer split
a project's chain. Two projects' chains still run side by side, taking turns by rank where they overlap (ADR 0067 d4,
d9). A launch change between two rows stays a Leg boundary inside the one chain.

**d2. Sign-ins are settled at schedule, before any Leg starts.** For each member, schedule reads the MCP namespaces
its `## Launch` names as required and checks each answers from the row's launch profile. A server only Lachy can sign
in to that reads signed out raises one `hands_steps` list on his screen (each server, where to sign in, the evidence
that ticks it) while he is still in the sitting, and the chain's Leg 1 starts only once every needed server reads
signed in. A server he will not sign in to now, or a check that cannot run, leaves the rows that need it out of the
chain, unstamped, each named with what to sign in to; a later `/thread:orient --steer` takes them. The Leg's own
preflight stays as the backstop.

**d3. A row works only the checkout it launches from.** `serial-chains.py plan` refuses any member, aliased or not,
whose writes sit in a checkout other than its launch folder's, and names that checkout's launcher as the remedy when
the launch catalogue has one. A surface added for a member at schedule obeys the same rule.

## Consequences

- An orient's serial steer opens one Leg Session per project, never one per task.
- A day-shaped deadline is met by a sign-in in the sitting, not by a later repair.
- A project's serial work runs slower end to end, its rows in turn: he chose that over the Session count.
- A vault note's claim that a service is signed in ("re-authed 11-03") is no longer the evidence: d2's live check is.

## Decided for him (overturnable)

- A cross-checkout row → refused, or relaunched from its own checkout (technical: a review cannot leave the
  Session's cwd, so such a row can never finish; d3).
- The sign-in check runs from each row's launch profile, not from the scheduling session's (technical: MCP auth is
  per Session and per profile).
- Rows needing a server he will not sign in to now are left out, never launched to wait (priorities: Phase 41's "fix
  all rollouts when I sit down intentionally", and his pick here, "ask at schedule time").
