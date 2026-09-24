# 0017 — a pending handoff owns the thread's continuation (amends 0011)

Date: 2026-09-21
Status: accepted
*(Amended 2026-09-25 by thread-skill-p2-2: `<home>` resolves through
`skills/_shared/scripts/handoff-home.sh`, the one resolver handoff and close both call
(`handoff-lifecycle.md` § Home); a unit outside git or one whose repo ignores
`docs/handoffs/` falls back to `_shared`; close also scans a shared thread's `_shared` docs,
owned there by `thread:`, and the doc its Resume pointer names; every doc carries a
`Run from:` line; and a handoff closes the thread's open captures as superseded, which a
withdrawal reopens.)*

## Context

ADR 0011 left `thread:close` exactly one approval gate: vault tasks are proposed, never
created unsolicited, because a junk task sits on the daily agenda until someone cleans it
up. Its § Rejected records the alternative — fully autonomous, vault tasks included — and
why it lost.

On 2026-09-19 a close proposed three vault tasks after a session that had just written a
handoff. Two of the three were the handoff's own § What remains. Lachy's ruling, grilled
that day: he tracks a handoff as a **single object** — he acts on it, or he converts it
into a task himself — and a task menu restating it is a second tracker for work he is
already tracking. It reads as though the handoff did not count.

A first implementation was written the same day and reverted whole after an `xhigh`
clean-room review returned fifteen findings that collapsed into one category error
(`docs/reviews/2026-09-19-bf71ad5-80f668.md`; estate METHOD K27). The rule keyed on "a
handoff, stash or defer doc" — but `stash` and `defer` write a capture *task*, never a doc,
and the addendum landed in the spec they follow "exactly", so it told stash to suppress its
own only artefact; and `thread:handoff`'s doc was optional and written to OS temp, described
in its own file as "throwaway", yet was made the sole destination for the continuation. The
artefact that had actually motivated the rule was a fourth thing: a durable `docs/handoffs/`
doc that the session-safepoint stop hook mandates, and that a memory
(`feedback_handoff_docs_lifecycle`, 2026-08-10) had been overriding the skill to produce by
hand since the apprenticeship handoff landed in `/tmp`. Two artefacts shared the word
"handoff" and the rule bound the wrong one.

## Decision

Two coupled parts; the second is built on the first.

**1. The handoff doc is durable, mandatory and self-cleaning.** `thread:handoff` always
writes `<home>/docs/handoffs/<YYYY-MM-DD>-<slug>.md` — `<home>` the *unit directory*: the
project directory under `~/Projects/` and the workspace directory under `~/repos/workspaces/`
(both are monorepos whose toplevel would pool every unit's handoffs), else the git toplevel —
and commits it by pathspec before anything else — never OS temp, never the vault, never by
editing a `.gitignore` (an ignored unit falls back to the workspace directory). One doc, one
consumer: a brief for two sessions is two docs. Its body follows the list the stop hook
already mandates (done and verified, what remains, decisions settled, gotchas, suggested
skills, paste-ready prompt), so a hook-forced handoff and a requested one are the same
artefact. Front matter carries `thread:` (the THREAD.md's `slug:`), `written:`, `status: pending`
and, once close has refreshed it, `refreshed:`. The consuming session — via the paste prompt's first instruction,
`thread:open`'s handoff-doc pickup, or a resume whose THREAD.md points at the doc — reads
it and sets `status: consumed` in place; that session's `thread:close` deletes the doc in
its close-out commit (`git rm -f`, because the mark is a local modification). A handoff
withdrawn in the same session is removed at once. Git history is the archive; the working tree lists only in-flight
handoffs. A manual handoff (no native task could be created) is a complete handoff for the
lifecycle: what it lacks is the task, not the tracker.

**2. While a handoff doc is pending, it owns the thread's continuation.** At close, a
pending doc for the active thread is the single destination for everything the next session
on this thread would do. Three rules, in close § The handoff owns the continuation:

- *Scope is the line.* The test for each vault-task candidate is "would the next session,
  working from this doc, do it?" Continuation goes to the doc; a loose end still reaches
  the menu.
- *Refresh, don't restate.* Close re-reads the doc against its own scan and writes any
  missing continuation state into it, committed by pathspec. This is the whole handling for
  a handoff written mid-session and overtaken by later work.
- *No annotation, no asking.* The step-8 report row is the visibility.

Every test is on disk — one `find` over `<home>/docs/handoffs/`, the front-matter
`status:` read by `awk`, ownership by location (a doc in this unit's directory is this
thread's unless its `thread:` names a *different* thread the unit also carries), and
"consumed" meaning *delete at close whoever marked it*, since consumed means the thread it
briefed went live and history keeps the pending version — so the rule is decidable after a
context compaction, like every other determination in close, with no half of it left in the
conversation.

Evidence the wording binds, from a five-rep rig before this ADR was committed: a temp repo
with a committed pending handoff, a THREAD.md, and four category-3 candidates (two the
handoff already owned or should own, two loose ends). Two reps running the pre-change close
proposed all four as vault tasks — the 2026-09-19 failure reproduced. Three reps running the
new close proposed exactly the two loose ends, folded the new continuation item into the doc
by refresh, and printed the handoff row. Fully separated; no rep asked or annotated. Two further treatment reps after each of the
two clean-room review rounds converged on the same menu and the same report row. The review
chain itself stopped after round 2 by METHOD K27 — eight of its fifteen findings were about
round 1's fixes — with the rig, not a third round, as the gate.

How the reverted review's six requirements are met:

1. *Key on the durable repo handoff* — part 1 makes it the only handoff artefact there is.
2. *Leave `task-writer.md` § 2 untouched* — it is untouched; stash and defer keep writing
   their task, and their capture task is itself the tracker, so there is nothing to suppress.
3. *Amend step 8's report contract* — it now carries `handoff pending:` / `handoff
   consumed:` rows, never silent when a doc exists.
4. *Resolve the Destinations conflict with the THREAD.md row* — THREAD.md keeps state,
   decisions, quirks and the session log; its resume instructions point at the doc rather
   than restating it. The continuation has one copy.
5. *Handle mid-session-then-superseded* — the refresh rule; a doc with nothing to add is
   left byte-identical and reported `unchanged`.
6. *ADR + both manifests* — this record; `plugin.json` and `marketplace.json` both at 2.5.0
   (they had drifted: 2.4.0 against 2.3.5).

## Rejected

- **Keying on `thread:handoff`'s temp compaction, or on stash/defer captures** — the
  reverted design. The temp doc was optional and throwaway; the captures are tasks, and
  they are the tracker.
- **Keeping the doc optional.** The rule would fail to fire in the ordinary handoff case
  (finding 4), the stop hook already mandates the doc, and a handoff that leaves nothing
  durable behind is the failure the 2026-08-10 memory was written against.
- **`git rm` at pickup as the consumed signal.** A staged deletion hides an in-flight
  handoff from `ls docs/handoffs/` and lingers if the consumer dies. The `status:
  pending → consumed` mark is the review-doc lifecycle the estate already runs
  (`fresh-review`), and a consumed-but-undeleted doc from a crashed session is still
  readable and still recoverable.
- **Treating every doc without `status: consumed` as pending.** The first draft did; the
  round-1 review found seven pre-existing docs with no front matter at all, one of them
  already consumed by its own title. They would have been pending forever, silencing
  closes in the workspaces repo. Docs without a `status:` line are *legacy*: listed,
  never touched, brought in by hand.
- **Multi-consumer docs with a reader count.** One doc in the wild was kept alive for a
  second session; the fix is writer-side — one doc per consumer — not reference counting
  on delete.
- **A TTL on pending docs.** An abandoned handoff would then silently re-enable task
  proposals on a date nobody chose. The report row carries `written:` instead, so age is
  visible at every close and the call stays Lachy's; a handoff withdrawn in-session is
  removed by the session itself.
- **Annotating suppressed candidates, or asking whether the handoff was done** — ruled out
  by Lachy; both hand back a decision the rule has already made.
- **A Destinations row that also claims THREAD.md's candidates** — finding 6; the table's
  "exactly one destination" is kept by making THREAD.md's resume instructions a pointer.
- **Extending suppression to stash/defer** — nothing to suppress; see requirement 2.

## Consequences

- 0011's sole gate narrows but does not fall: vault tasks remain the only proposal, and a
  pending handoff doc removes the thread's continuation from the proposal set. This is one
  step toward 0011's rejected "fully autonomous including vault tasks" and deliberately no
  further — the reason 0011 rejected it (junk on the agenda) does not apply, because the
  doc is not on the agenda and is Lachy's to convert or not.
- The stop hook (`workspaces/_shared/scripts/session_safepoint.py`) and the skill agree on
  path, body and front matter — the hook's message now names `thread:` / `written:` /
  `status: pending`, so a hook-forced doc enters the lifecycle like a requested one.
- Close's commit surface widens by one file: the handoff doc, by pathspec, in the repo the
  work is on and on its current branch — the same commit the handoff itself made. Nothing
  else in that repo is ever staged or committed by close; a half-applied git operation or
  detached HEAD skips the commit with a `not versioned:` line.
- A consumer that exits via `stash`/`defer` rather than `close` leaves its consumed doc for
  the next close in that repo. Stash and defer stay lightweight (ADR 0014) and untouched.
- Memories `feedback_handoff_docs_lifecycle` and `handoff-owns-the-continuation` stop
  overriding the skill; the skill is the source. The Codex adapter stub for handoff drops
  its OS-temp line.
- CONTEXT.md gains **Handoff doc** and **Continuation**; **Pickup** now covers both
  artefacts, and `thread:open` gained the handoff-doc pickup mode that makes that true.
  `thread:next`'s dispatch line and the README row describe the durable doc.
- ADR 0011 carries the amendment note, per the convention ADR 0015 set.
