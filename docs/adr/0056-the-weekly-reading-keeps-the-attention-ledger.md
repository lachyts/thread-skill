# 0056 — The weekly reading keeps the attention ledger, and a detector for work that circles

Date: 2026-10-28
Status: accepted. Written for the vault task `thread-skill-p30-7-the-question-and-review-loop-ledgers` (Phase 30 · Task
7), from the 2026-10-25 audit of 21–25 October and Chorus ADR 0110; its plan was judged over two runs before the build.
Widens ADR 0051's Time-lost ledger to the work before a rollout and to Lachy's attention, and adds two Watches under ADR
0037's rule. The question gate it measures is ADR 0054.

## Context

The audit of 21–25 October read every question the thread skills put to Lachy and every /fresh-review round of the
week. It found what no Reflection could: 76 questions in the nine Sessions it read (79 by this ledger's count), 4 of
them his to answer (ADR 0054 is the gate that answers that); PRs reviewed for 9 to 15 rounds with STOP verdicts handed back to him; a rollout
scheduled and never started for days; and work items that Session after Session named and nothing merged. The weekly
reading reads the Run record only, and the Run record holds none of this: a question is in a transcript, a review round
in `reviews.jsonl`, a wait in the vault's `captured:` dates. ADR 0051's Time-lost ledger prices the hours the engine
lost once a rollout runs; the hours spent before it runs, and the attention spent on it, had no ledger.

## Decision

**The weekly reading keeps an attention ledger beside the Time-lost ledger: the questions put to Lachy by Owner, each
PR's review trail, each rollout's wait to start, and a circling detector that opens a Watch on work that is touched and
not merged. A script reads every number; the reading's one judgement is each question's Owner.**

- **d1. The `attention` line.** `skills/reflect/scripts/attention.py` builds span's `attention` block, and `reflect.py
  attention` (SKILL step 13b, after the ledger) writes one `attention` line per Reflection to `reflections.jsonl`: the
  questions counted by Owner, the trails' counts, the waits and the circling items. A changed re-run appends one line,
  and readers take the last. It is its own kind, never a seventh Time-lost class: its units are questions, rounds and
  hours of waiting, not engine hours, and the estate contract's ledger line stays as it is.
- **d2. The Question ledger.** Every question of the question tool in the window, read from the main chain of the
  session transcripts (each call once, by its id): its outcome (answered, dismissed, dropped, open; a call he never saw is
  failed and never counted as asked), its recommended option and whether he picked it, his own words or note, and the
  hours it held work, a call's hours split over its questions. The reading labels each question's Owner by
  `skills/_shared/asking.md` § 1 into `owners.json`, in batches. Labelling never blocks the close: `--rest-unknown` writes
  the remainder as `unknown`, counted as `unlabelled`, and *yours* reads as a lower bound while it is above 0.
- **d3. Review trails.** The /fresh-review rounds of one PR, keyed by its landing merge, else its branch, else a run of
  rounds in one checkout (a gap of 12 hours or a head that does not descend from the last starts a new run), each read
  whole once a round falls in the window. Per trail: rounds, STOP entries (each entry into the stop verdict), the stop
  rounds a question followed within 30 minutes from the same checkout (handed to him), and whether the PR changed docs
  alone. Git is read locally, never fetched.
- **d4. Waits to start.** A rollout's wait runs from his ask, the earliest `captured:` of the tasks its queue links
  (carried rows aside), and from its scheduling, its own `captured:`, to its first Slot; while it has none, to the
  reading's end.
- **d5. Circling opens a Watch counted in readings (ADR 0037).**
  - **W1**: a work item (a task note with `phase:`, `pr:` or `rollout:`) that three or more Sessions touched in 14 days
    with nothing merged, while no rollout held it at the reading's end: never dispatched, or set aside since its last
    Slot. An item in a Slot, in review or in the Integration lane is the engine's, whose round settings cap it and whose
    Time-lost ledger prices its rework, plan blocks and stalls; the Sessions that schedule and lead a rollout name its
    items, so counting them would measure how long the rollout ran; and once set aside it circles again, so W1 counts it.
    The 21–25 October probe lists seven items, two of them set aside and left (chorus-p66-4 and thread-skill-p27-5),
    and none a held one; a third set-aside task, chorus-the-companion-recovers-a-stalled-rollout, carries none of the
    three keys, so it is no work item.
  - **W2**: a rollout open 48 hours with nothing merged. Its candidates are every record with a note, and each real
    rollout note with no record (a slug name, `protocol_version:` or a `## Queue`) whose status is outside the Time-lost
    ledger's closed set; the Rollouts hub, tagged `reference`, never is.
  - **A reading's own Sessions never count as touches**, on either rule: a Session whose main chain runs reflect.py's
    span verb, a reflect.py or attention.py verb on a span file, or score.py or serial-score.py (a by-hand Reflection, or
    Chorus's routine reading). The reading's step 11 trace and step 15 `why` name every item it lists, so counting it
    would feed the detector its own reads: the 25 October reading (ec032fe5) traced thread-skill-p27-5, and by 27 October
    it would have been that item's sixth Session. The test is the interpreter and the verb, never the script's name: a
    Session that only greps or edits reflect.py, or runs `rung`, keeps its touches. Chorus's own reflect script is
    another file, and Chorus's routine reading (f7f7890f) is left out through score.py.
  - A Watch's items are the slugs a run_record line takes; any other is dropped with a flag, never refused, so the line
    and the close are never blocked. A closed cycle's items are never listed again: a partial overlap writes its fresh
    items alone, in a cycle that recurs only at its own second reading.
  - The rule text carries no ADR number, so a Watch id (sha1 of rule and shape) survives a renumbered ADR. The unit is
    readings, not rollouts: a rollouts unit would make any two-item W1 list recur in its first reading. So a lone item
    recurs in its second reading, and a reading that keeps finding fresh items alternates a quiet week with a rule item.
    A rule item reaches Lachy by ADR 0037's existing path, the decision task, his to decline: this decision adds no
    question of its own.
- **d6. Decide and close wait for it.** A span with an `attention` block and no `attention` line from its Reflection is
  refused by decide (`run attention`, nothing written: the decision task's section is written once, so a decide before
  attention would lose the circling Watches for good) and by close, after the ledger's gate. A span from before this
  decision closes as before.

## Naming

"Loop" is not this decision's word: `~/.agents/knowledge/reflection-loops.md` calls each Reflection a loop, and
CONTEXT.md's review loop is the engine's convergence of plan, verify and review rounds. A trail is a PR's /fresh-review
rounds, not a chain (`review-ledger.py`'s, narrower); circling is work touched and not merged, not a stuck item or a
Stalled rollout (one with nothing moving). The terms are CONTEXT.md's **Attention ledger**, **Question ledger**,
**Review trail**, **Wait to start** and **Circling**.

## Considered options

- **A seventh Time-lost class:** rejected. Questions and review rounds are not engine hours, and the class set is the
  estate contract's.
- **Counting circling Watches in rollouts:** rejected (round 2 of the plan review). A two-item W1 list would recur in
  its first reading, so every week would carry a rule item.
- **W1 counting only items never dispatched:** rejected (round 2). It would miss the items set aside and left, two of
  the seven in the probe.
- **The question count only, with no Owner:** rejected. The audit's finding is the share that was his; only the label
  reads it, and asking.md § 1 is the one rule for it.

## Consequences

- The weekly reading reads the session transcripts every week, read-only: about 300 questions a week, labelled in three
  or four batches. Question text stays in `span.json`, scratch that step 17 removes.
- A Session that tests the reading's verbs by hand loses its own touches, and a reading run through a shell variable
  keeps its own: both are named in SKILL § What the record cannot show.
- Trails read the local refs: a `fetch --prune` that drops a remote branch can split a trail keyed by it.
- `reviews.jsonl` keeps three readers of its rounds (score.py, reflect.py's churn, attention.py) until a shared one lands.

## Decided for him (overturnable)

- The Owner label is the reading's model call, in batches of at most 100, never a script's; a remainder it cannot label
  is `unknown`, flagged, and never blocks the close.
- A STOP handed to him is any question within 30 minutes of a stop round from that checkout, whatever it was about.
- W1's threshold is three Sessions in 14 days; W2's is 48 hours. A rule item with `amends` ADR 0056 d5 is where a yes
  tunes them.
- A work item W1 counts needs `phase:`, `pr:` or `rollout:`; a task with none (a hand-filed note) is never W1's.
- A rollout note with no record is judged by its status now, so one closed after the reading's end is never W2's for
  that week.
- A serial chain has no wait to start: its Legs take no Slot.
