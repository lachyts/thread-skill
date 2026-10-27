# 0050 — A red that a second full run clears is a Flake

Date: 2026-10-21
Status: accepted. Ruled with Lachy in the re-grill of PR #202 (ADR 0048's audit). Amends ADR 0030 decision 3's Integration verify, which reads any red as red. Built by p29-9 (2026-10-27).

## Context

In `chorus-rollout-2026-10-18`, 6 of 9 Integration suites the lead ran failed on one timing test outside every diff, under load. Each red cost another full suite (20 to 50 minutes), and conflict Integrations that chased such reds took about 17 hours across three tasks; one integrator (p84-8) wrote a fix for the timing test inside its own task. Execute has no notion of a flaky test: a red is a re-verify or a set-aside. Its two neighbours do not cover it: a known baseline failure (schedule § 2.6's manifest) is a test already red on a clean `main`, which execute's green criterion already allows for (no new failures beyond the manifest), so it is never a Flake candidate; merge-task's `infra_flake_rerun` re-runs a remote CI job only when every failed step is setup, never a named test. ADR 0049's Away cap makes such reds rarer, not impossible.

## Decision

**When any verifier run in a rollout (a task call's, an integrator's, the lead's Integration verify or a RACE re-verify) is red only on named tests the task's diff does not touch, those tests are re-run first: if any fails again, the verify is red at once. If they pass, the full suite runs exactly once more on the same tree to rule out a leak or an order dependence; green, and each test that failed the first run is a Flake: logged, and filed as a follow-up for its repo, never fixed inside the task. A red full run is red.**

- For a RACE re-verify (ADR 0046) the diff is the merged task's.
- **A red that names no failing test is never a Flake.** A timeout, or a lint, typecheck or build step, is red; a timeout is also logged as load (ADR 0051).
- A failing test the diff touches is red, as today.

How p29-9 built it:

- **Placement by test file.** A failing test is placed in a test file (pytest's `path::name` before the `::`, else the whole id), and "the diff touches it" means that file is in the task's diff. A test that cannot be placed (a spec name, a path outside the tree), a red that names none, or more failures than the parser reads (50) is red at once. The agents read their diff the same way.
- **`named_rerun:`.** The lead's verifies (`lead-integrate.py verify --diff-base`) re-run by name through the rollout's optional `named_rerun:` command, `{tests}` replaced by the shell-quoted tests; `/thread:schedule` stamps it from the project `CLAUDE.md`'s `Named re-run:` line and reads it back with the lead's own reader (`verify-timeout`), so a command the lead would refuse never reaches a runnable note. With none declared, the lead's red stays red; the engine's agents use the repo's own runner either way.
- **The deadline cap.** Each Flake-check run (the named re-run, the confirming run) gets the verify's own `--timeout`, capped so the whole `verify` ends inside the lead's two-hour harness bound less its 600-second margin; no time left is red.
- **`suite-timeout`.** A deadline in any of the runs is red and is logged to the Run record as load (`suite-timeout`, ADR 0051); each Flake is a `flake` event and a line on one follow-up task per repo and test (`<project>-followup-flake-<h>`). With p29-10's `verify --rollout` suite record beside it, a Flake's suite ends green and a deadline in either Flake-check run ends it `timeout`.
- **The Heat hold (estate ADR 0009 d5).** A heat stop in the named re-run or the confirming run is no verdict, as in the first run: `verify` goes back in line and reruns every step, the Flake check included, so the failing tests are always the last pass's first run's.

## Considered options

- **Re-run only the failing tests, alone, as the proof** (ruled first, then changed in the round-3 review the same day): rejected. A test the task's change leaks state into, or makes order-dependent, fails in the full suite and passes alone, so the break merges as a Flake and keeps passing alone at every later Integration. The named re-run now only decides fast that a red is real; the full run proves a Flake.
- **A full run straight away** (ruled in round 3, then changed in the simplify round, 2026-10-22): rejected. A real red that fails again on its own named tests would pay a whole suite to find out.
- **A quarantine list** each repo's Integration verify ignores, like the known-baseline-failures manifest but for tests green on a clean `main`: rejected. Faster, but a listed test can hide a real break for as long as it stays listed.
- **Red is red, and fix flakes at the source** (the Away cap, Chorus P86): rejected as the whole answer. Both reduce flakes; neither ends them, and every one left costs a suite.

## Consequences

- An intermittent real failure can pass its one re-run and merge. A real red costs only its named re-run; a Flake costs one extra suite, against the open-ended chase it replaces. The Flake log is where it shows up again, and a test logged as a Flake twice is the repo's to fix.
