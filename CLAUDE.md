# thread-skill

## Tests

Verifier: `make test-fast`
Completion verifier: `make test`
Tests: one test file, hermetic: `bash tests/run.sh --only <test file>...`

`make test-fast` is the fast tier: the always-run checks, then only the test files the diff reaches. That reach is
declared in tests/fast-tier.map, and tests/lib/fast-tier.py's header holds its rules. A changed path the map cannot
place runs the full suite (ADR 0073 d1). Every run, `make test` included, checks the map and names what is missing:

- A new script under skills/*/scripts/ or hooks/ is already placed by `skills/**` or `hooks/**`; it needs only a
  test that names it (check d). It needs a map line only when it should be FULL or no test names it.
- A new tests/fixtures/<d>/ needs a `tests/fixtures/<d>/** <consumers>` line (check e).
- A new test that lists a directory joins the walkers' `** ALSO` line or an OWN-LISTINGS line (check f).

tests/fast-tier.map is itself FULL, so a diff that edits it runs the full suite at both Checkpoints and at
Integration: edit it only when a check names a missing line.

## Review rule: a reading holds only its window's rows

Some outputs here are read by no script: span.json's reported blocks, a score's sums, the claims a docstring
makes. A reading that sums over a span wider than its window is wrong in a way no test or gate catches. Review
round c6f5bb9/ba8597 #6 found one before it landed: freshReview kept a group whole once any round fell in the
window, so the default branch's entry folded in every round ever recorded and grew each week.

A reading's window is the [since, until] its docstring declares (CONTEXT.md's Window, a canary's arm to its
check, is another thing).

1. Every windowed or aggregated reading holds only rows inside its window, by the row unit its docstring
   declares: an instant by its parsed time (a /fresh-review round by its `reviewedAt`), a date-only row by
   `date_in()` (since's Melbourne date up to, not including, until's), a landed task by its merge. Some readers
   declare a wider unit on purpose, and are held to that unit:
   - a rollout's score (score.py, serial-score.py) reads the rollout's whole life, from its first slot-taken or
     first Leg to until, so its sums run wider than the reading's week; its Escapes are read up to now, and
     rounds per landed task count each landed task's rounds over its whole record;
   - the Escapes sweep (reflect.py) folds landed tasks of any age; its friction rows are only the evidence
     dated in the window, and cannotShow names only the Escapes no week's friction lists (a chain's line names
     every one dated outside the window);
   - a grade episode (grades.py) counts in the window that holds its close, its acts from before since included,
     and grades' `all` holds every closed episode;
   - a Review trail (attention.py) is read whole, back to since - `TRAIL_DAYS`, once any of its rounds is in the
     window; a wait to start is a row per rollout that started in the window or is open at until; circling reads
     its own [until - `TOUCH_DAYS`, until];
   - the Monthly audit (ledger.py) reads its month.
   A reader that reads wider says so in its docstring, the one copy of its rule, and is named here.
2. A test pins it: for each windowed reader, plant one row outside the window and assert it is absent, or adds
   nothing to a sum, as tests/reflect-weekly.test.mjs's "freshReview holds only rounds reviewed in the window"
   does.
3. Hold a diff to this rule when it touches a reader whose docstring declares a row-level window, and it widens
   that window, groups rows before it windows them, or keeps a group whole once one row is in the window. A
   reader on the list above is held to its own declared unit instead. span's `window: ` flags are the read-time
   check (reflect.py's header, "The window check"): one in a weekly reading is a bug.
