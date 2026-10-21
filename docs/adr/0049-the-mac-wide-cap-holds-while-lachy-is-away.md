# 0049 — The Mac-wide cap holds while Lachy is Away

Date: 2026-10-21
Status: accepted. Ruled with Lachy in the re-grill of PR #202, after an audit of where rollout time went. Overturns Chorus ADR 0104 decision 3 ("Away, every Rollout to its own ceiling"); the Trickle by day (its decision 2) stands.

## Context

Machine load cost about 25 to 40 hours from September to 21 October, and more indirectly: on the night of 18 to 19 October eight rollouts ran to their own ceilings at load 139 to 149 on 12 cores, Chorus's suite took 20 minutes to 2 hours, three verifies hit the 60-minute timeout, and timing tests failed outside every diff, so integrators chased flakes with further full suites. The Trickle caps Rollout tasks across the Mac only while Lachy is not Away, to keep the Mac usable for him; at night nothing caps the count, and the Verify slots order who runs a suite but not how many agents compete for the cores while it runs. The Integration priority (Integration and RACE verifies take the next Verify slot ahead of any task's) is already built (p23-4).

## Decision

**A Mac-wide cap on running Rollout tasks holds while Lachy is Away too: the Away cap, a knob of its own, larger than the Trickle and sized so suites do not contend.**

- By day the Trickle binds; Away, the Away cap does; each rollout's `parallel_ceiling` still bounds its own share either way.
- The Away cap starts from the Run record and is tuned there like any knob (ADR 0032): the Reflection reads suite times and verify reds against how many tasks were running.

## Considered options

- **Leave it to a cheaper suite** (Chorus P86's lean, parallel suite): rejected as the whole answer. A parallel suite uses more cores, so it contends harder under the same load.
- **Lane first only:** already built; it orders suites but leaves the load.

## Consequences

- A night of many rollouts finishes later per rollout but wastes fewer suites; Throughput is the Guardrail that bounds how low the cap may go.
- Chorus ADR 0104 needs its decision 3 amended to point here.
