---
name: repair
description: 'Use to unstick a rollout that has stalled — run it whenever there''s an issue with the whole rollout, not a single task. Triggers on "repair [[rollout]]", "fix this rollout", "[[rollout]] is stuck", "sort out [[rollout]]", "unblock the rollout", or after /thread:status shows blockers/drift. A thin CONDUCTOR over /thread:execute (never a second engine): it diagnoses (runs /thread:status), reconciles drift, asks YOU only the decisions no agent can make and writes them into the notes, leaves agent-fixable blocks to execute, dependency-aware-defers wedged tasks, then hands off to execute''s resume — the engine keeps sole merge authority. Scope: Obsidian + gh/git + the execute engine.'
---

# /thread:repair — sort out a stuck rollout (conductor, not an engine)

`/thread:repair [[rollout]]` is the **"something's wrong with this rollout — sort it out"** verb. You point
it at the rollout (never a single task); it figures out what's stuck across the queue, does the mechanics,
and asks you only the decisions no agent can make.

It is a **conductor** over execute's queue loop, not an engine (see
`docs/adr/0004-repair-is-a-conductor-not-an-engine.md`). Execute's lead already restarts a stalled task,
launches an automatic seeded revise, integrates each approved task and merges it. Repair adds only what the
loop can't do by itself: hand a set-aside task back at the **stage it stopped** once Lachy has answered it
(ADR 0030 decision 4; the lead's automatic retry re-enters the agent-fixable ones itself, ADR 0033), capture an
**input-gated** decision or a `## Needs you` answer, record a gate sign-off, record an **automatic descope** of a
plan-block the notes settle, raise a review budget **on Lachy's word**, **defer** a wedged task with its
dependants, flip a **merged, never marked** task, **escalate** a merge the notes never recorded (or a RACE, or one
into another base), and finish an interrupted supersede's **close-out**.
It never re-implements Integration, merge or convergence, and **the engine keeps sole merge authority**.

## Native runtime binding

Diagnosis and authorised deterministic reconciliation (the hand-backs, the notes writes) run in either
harness. Any task call goes through execute's native runtime preflight and its canonical engine, with the
original run's caller/session and native child identities. Read
`~/repos/workspaces/_shared/scripts/native_workflow.md`. A new harness must not adopt or replay another
session's pending claims. Recover the actual native children first; otherwise report the unresolved
ownership. Codex has no detached driver: repair preserves the diagnosis and the hand-backs, and the queue can
then run only as a session-driven `--gated` run. Do not claim that a request for continuous repair has been
completed by preparing one. Never create a second convergence engine.

## Scope

Reads/writes `~/repos/obsidian/Work/Tasks/`, makes `gh`/`git` calls against the target repo, and drives
`/thread:execute`'s queue loop. Merges only ever happen through execute's merge step (`merge-task.sh`).

## Invocation forms

```
/thread:repair [[giflab-rollout]]      # diagnose, fix what it can, ask only the decisions, run the queue to done
repair [[giflab-rollout]]            # natural language — same thing
fix this rollout                     # resolves to the rollout in context
```

## Skill flow

### 1. Diagnose

Resolve `[[<slug>]]` (ask if ambiguous). Run the **`/thread:status` scan with the live cross-check on**
(repair is about to act, so it always checks reality): the per-task queue state, each task's
`lead-integrate.py inputs`, the drift flags and the repo path. Show the user the situational report first:
they should see what they're repairing.

**Stops**, first match in this order, before anything else and before anything is written (the close-out
below writes only on Lachy's confirmation). The lineage stops come first, whatever the note's
`protocol_version`: a supersede is how a legacy rollout migrates, so a legacy note can be a close-out, and the
version stop's `--regenerate` would only meet schedule's refusal again.

- `superseded_by:` → point at the successor (`/thread:repair [[<successor>]]`). Stop.
- **Close-out interrupted** (status § 1's reverse lineage: another rollout `[[N]]`'s `supersedes:` names this
  one, and this note has no `superseded_by:`), at any `protocol_version`. A supersede carried this rollout's
  unlanded tasks to N and died before schedule step 7.5 closed this note out. Never reinstate, resume or hand
  back here: the carried tasks are N's.
  - N never ran (its `incomplete` is non-null) → `/thread:schedule <project> --regenerate`: schedule § 0's
    `interrupted` line finishes that supersede. Stop.
  - N has run → finish step 7.5's close-out, **on Lachy's confirmation**, and only when status counts no
    running, integrating, awaiting-Integration, queued or set-aside task here (`carry` moved every such task;
    one still here would be stranded, so show it and stop). Stamp `status: done` and
    `superseded_by: "[[N]]"` on this rollout note, then `mkdir -p ~/repos/obsidian/Work/Tasks/Archive/Rollouts/`
    and a plain `mv` of the note into it. A same-named file already there → skip the move and report the
    collision. Write nothing else. Stop, and point at `/thread:status [[N]]`.
- `protocol_version` absent, `2` or `3` → execute § 2's remedy: hard-pause it if a session is running it, then
  `/thread:schedule <project> --regenerate`. Stop.
- any other value except `5` → "unsupported protocol version <N>; the queue reads protocol_version: 5". Stop.
- `incomplete` → `/thread:schedule <project> --regenerate`. Stop.

Then one of three modes holds, each evaluated before anything is written: a pause, a live queue, or no lead
live. Two rules cut across them.

**In every mode**, on Lachy's confirmation where § 3 asks for it, repair may write what no live call reads or
overwrites, because each is independent of the pause and the lead:

- § 3c's escalation and its record: the evidence, the dated `## Notes` line on the rollout note, and, once
  Lachy decides a RACE / UNVERIFIED, its `RACE decided:` line. That line is what lifts the hold on `resume`
  (§ 3c), so neither a pause nor a live lead holds it back; only a decision that the merge does not stand
  waits, for its defer (a lead-held note, below).
- § 3b: a decision into a set-aside task's `## Repair input`, and, with a `## Needs you` answer, the removal of that
  section.
- § 5: a defer of a set-aside task with its queued dependants.
- § 3e: the git-env ack, on Lachy's word. The canary's `ack` writes only the rollout note's `## Git-env log` and
  its own records, and it re-baselines a live window rather than overwriting a note. § 3e's `restore` is not an
  every-mode write: it waits until nothing of the rollout is in flight. Its `--bare-only` form, which moves no
  ref, runs with (b)'s ack.

**Lead-held notes.** § 3c's `pr:` write and § 3c's defer of a RACE / UNVERIFIED task whose merge Lachy decides
does not stand write a task note a live call's reconcile would overwrite. They run only when no lead is live
(every owner session has ended or shows no run there, a drain nothing is draining included) or under a
stamped pause, where no call is live; otherwise they wait for the stamp or the lead's end.

**Pause, drained or stamped.** While `pause_requested` drains, or `paused:` stands:

- Repair reports the pause. Stamped → "reinstate with `/thread:execute [[<rollout>]]`". Pending → "it drains;
  nothing to do" while a lead is live (the owner check below); with none, nothing is draining it, so
  `/thread:execute [[<rollout>]]` resumes the drain. Either way, point at `/thread:execute` only once every
  RACE / UNVERIFIED task has its `RACE decided:` line: its *Cold resume* runs `resume` first.
- Beyond the every-mode writes it never runs `hand-back`, `approve-gates`, § 3d's `descope`, the raise, `resume`
  or the loop, and it never clears the stamp or the flag.
- Why: `next` stamps `paused:` only once nothing runs, awaits Integration or integrates. A hand-back during the
  drain would put a task back into exactly those states, and the live lead would integrate and merge it after
  Lachy asked to pause. Under a stamped pause, the reinstate decides what restarts.
- The lead-held notes above run under a stamped pause (and under a drain nothing is draining), each leaving
  `resume` to the next *Cold resume*.

**Live queue, not paused.** A running or integrating task carries an `owner:` whose session is not known to
have ended. A Workflow run is listed only in the session that launched it, which the tag names, so check
`/workflows` in that owner session; from any other session "no run" proves nothing, so report "possibly live:
check session `<owner tag>` first".

- Beyond the every-mode writes, repair may hand back a set-aside task once Lachy has answered it (§ 3b), never one
  § 2 classes **retry (automatic)** (§ 2 classes it before any answer: a hand-back on his answer is the fresh
  stretch he chose). It may also run § 3d's `descope` on one (wherever `hand-back` may run), apply a raise he chose,
  run `approve-gates` on sign-off, and write the `pr:` § 4's restore finds for an at-Integration set-aside with no
  `pr:`: no live call owns a set-aside note, so that write goes with the hand-back that follows it (§ 4).
- It never runs `resume`, never enters the loop, and never writes a running or integrating note, because a
  live call's reconcile would overwrite it: the lead-held notes wait for the lead's end.
- A RACE re-verify in flight (§ 2) is the lead's: report it and wait. It becomes a § 3c escalation only once
  its owner session shows the `RACE: …` halt or no run, or has ended. A git-env halt ends it too: a `## Race log`
  line naming it that carries `git-env halt`, or the owner session's `git-env trip…` / `git-env canary failed`
  halt, makes it a § 3c escalation (§ 3e hands it there).
- The live lead's next `next` restarts an `in_progress` hand-back and integrates a `review` one.

**No lead live.** No pause, and every owner session has ended (or shows no run there): the full flow, § 3 to
§ 6, except that an undecided RACE / UNVERIFIED escalation holds every `resume` and the hand-off (§ 3c).

**Sent here by schedule's unfinished-rollout refusal.** Repair sorts out what is stuck; superseding stays
schedule's `--regenerate`. A refusal line `<P> is named by the supersedes: of <N>, which has since run` is
the **Close-out interrupted** stop above: run `/thread:repair [[<P>]]`, and on Lachy's confirmation it closes
P out, so schedule's check no longer counts P.

### 2. Classify each unmerged task

From its queue state, its `lead-integrate.py inputs` (`resumeAt`, `autoRevise`, `lastIntegration`), its verdict
(`autoRetry`, `autoRetryWhy`, `autoRetryAfter`, `autoRetryError`, `fingerprint`) and `prUrlError`, status's
per-task `needsHuman`, and the live PR state. Each unmerged task takes the **first** class in table order whose
signal it matches. The order matters: a RACE task's PR is MERGED, and so is an UNVERIFIED one's, which is also set
aside at Integration, so they match **merged, never marked** and **at Integration** further down too; the order
escalates them before repair reaches for `resume` or `hand-back`, both of which hold back a held task themselves
(§ 3c). A RACE re-verify in flight comes first of all: it is the lead's own procedure, so repair neither escalates
it nor asks Lachy while the lead decides it. A plan-block is judged for a descope before the automatic retry, as
execute's step 1.2 judges it, and **retry (automatic)** and **needs you** come before **at Integration** and every
class below it.

| Class | Signal | Action |
|---|---|---|
| **RACE re-verify in flight** | status's in-flight RACE (status § 3): a `## Race log` line names it, it still reads `integrating` with an `owner:` whose session is not known to have ended, no `paused:` stamp stands, and its verdict file is absent or reads `0` | nothing: execute's RACE procedure owns it (green → `mark-done`, red → its `RACE: …` halt); never escalate it or ask Lachy mid-re-verify. Once its owner session shows the `RACE: …` halt or no run, or has ended, it is **RACE**. So is one whose `## Race log` carries a `git-env halt` line naming it, or whose owner session shows a git-env halt (§ 3e hands it to § 3c) |
| **RACE** | merge-task exit 5 (a `## Race log` line names it) and not in flight, or `UNVERIFIED:` in its set-aside reason, with no decision recorded (§ 3c) | escalate (§ 3c); never re-call merge-task; while it is undecided no `resume` runs at all (§ 3a, § 4's hand-off) |
| **PR-less merge** | status's "possible PR-less merge" flag | escalate with evidence (§ 3c) |
| **merged into another base** | its PR is MERGED into a branch other than the default (status's flag) | escalate with evidence (§ 3c); never hand it back or defer it, and `resume` leaves it unchanged (it checks the base) |
| **merged, never marked** | not done; its PR is MERGED into the default branch | `reconcile-rollout.py resume` (§ 3a) flips it done; never hand it back or defer it |
| **merge hold** | merge-task exit 7: review required on the integrating PR | "approve PR #N": Lachy's; never re-integrated, never set aside |
| **live** | running or integrating under a live lead | nothing: the lead owns it (§ 1) |
| **PR CLOSED / branch missing** | awaiting Integration, integrating (no lead live) or set aside at Integration, and its PR is CLOSED unmerged (status's flag) or `git -C <repoPath> ls-remote --exit-code --heads origin <inputs.branch>` finds no branch; or set aside at Integration with no `pr:` (`autoRetryWhy` `set aside at Integration with no pr: …`), which `hand-back` refuses | input-gated: § 4's restore, recut, defer or leave; never left to the loop, which would integrate it only for merge-task to set it aside at its own run; with no `pr:`, restore starts by finding its PR (§ 4) |
| **awaiting Integration** | `review` with a `pr:` | nothing: the loop integrates it |
| **queued** | `open`, its `waitingOn` unmet | nothing: it starts when its dependencies land (or defer it with its blocker, § 5) |
| **plan-blocked after a descope** | `plan-blocked` with a `## Scope decision (automatic)` section and no `descope_armed:`: it restarted after an automatic descope and blocked again | input-gated: § 3b, quoting the new feedback and the automatic descope; never a silent hand-back, never a second descope (the verb refuses one, exit 3) |
| **plan-blocked, descopable** | `plan-blocked` (`resumeAt: own`) with no `## Scope decision (automatic)` section, or one whose `descope_armed:` still stands (a descope whose hand-back never ran), its feedback centring on one part of the task that the note marks optional or that a later task in this rollout owns | `reconcile-rollout.py descope` (§ 3d): exit 0 → hand back (§ 4) → its own call, and tell Lachy afterwards; exit 3 → § 3b; judged before **retry (automatic)**, as execute's step 1.2 judges a descope before its automatic retry: a refusal writes nothing, so the verdict can still read `autoRetry: true` while the lead skips the key |
| **retry (automatic)** | set aside at its run or at Integration, and `inputs` reads `autoRetry: true` or a non-empty `autoRetryAfter`; a `plan-blocked` task reaches it only once the class above judged it not descopable | nothing: the lead re-enters it (execute § 4.5 step 1.2's *Automatic retry*), now or once its cool-down ends, and with no lead live § 4's hand-off does; never a hand-back, which would reset its budget |
| **needs you** | set aside at its run or at Integration (`setAsideAt: run` or `integration`, never a gate) with a `## Needs you` question (status's `needsHuman`) | input-gated: § 3b asks the question verbatim, writes the answer into `## Repair input`, removes the `## Needs you` section, then hands back at its stage (§ 4) |
| **at Integration** | `setAsideAt: integration` (`resumeAt: integration`) | input-gated (§ 3b): ask why it is his (`autoRetryWhy`), then on his word `reconcile-rollout.py hand-back --tasks <slug>` → `review`: it rejoins the Integration queue and retries Integration only; its branch, plan and review stand, and nothing before Integration is redone (§ 4). One with no `pr:` is **PR CLOSED / branch missing**'s |
| **revise (automatic)** | `autoRevise: true` | nothing: the lead (or § 4's hand-off) launches the seeded revise itself; with a non-empty `prUrlError` it launches nothing, so that one is input-gated (§ 3b): quote `prUrlError` (its `autoRetryWhy` names the seeded revise), and Lachy fixes the note's `pr:` or defers it |
| **revise stopped** | `revise stopped:` in the marker, `resumeAt: revise` | input-gated (§ 3b), then hand back (§ 4) → a seeded revise |
| **review-blocked, rejected** | `review-blocked`, `lastIntegration.outcome: rejected` | input-gated (§ 3b): offer the raise (§ 4, on his word), more guidance, defer or leave; then hand back → a seeded revise |
| **own run** | `resumeAt: own`: `blocked`, `plan-blocked`, `review-blocked` with no `rejected` line, a code-writing `review` with no `pr:`, a `merge-task:` set-aside | input-gated (§ 3b): ask why it is his (`autoRetryWhy`), then on his word hand back (§ 4) → its own call. A code-writing `review` with no `pr:` is asked too (the verdict never retries it: "repair's call"): hand back, so its own call opens the PR on its branch, or defer |
| **gate** | `gate-pending` | present the gates verbatim, and its `## Needs you` question (status's `needsHuman`), if any, verbatim beneath them on a `→ asks:` line; § 3b records his answer and removes the section before any sign-off; on sign-off `approve-gates` (§ 3b); never hand back |

**A signed task is the lead's.** After `approve-gates` the task reads `in_progress` with `gates_signed:`, or
`review` from an Integration stop. While its owner session is live, that session holds the signed-gate
handle (execute § 3.7): it resumes the gate-pending call on the plan Lachy signed. Repair never hands it back,
recuts, defers or re-plans it, and writes no `## Repair input` to it. With no lead live, the next *Restart
routing* takes a fresh call behind § 3.7's warning.

**Agent-fixable is execute's now (ADR 0033).** Repair never judges a block agent-fixable from its feedback: it
reads `inputs`' verdict. A set-aside at its run or at Integration that § 2 does not class **retry (automatic)**
reaches repair because its automatic retry is over (the auto-retry budget is spent, the fingerprint repeated, or
`needsHuman` is set), or because `autoRetryWhy` names another cause that is his: `auto_retries: 0`, an unresolved
budget, a quota block past its five free retries, a declined merge, a gone branch, a merge-task text a human must
clear, a `prUrlError`, an at-Integration set-aside with no `pr:` (**PR CLOSED / branch missing**) or a code-writing
review with no `pr:`. Either way it is input-gated (§ 3b), and the ask quotes `autoRetryWhy`. A non-empty
`autoRetryError` is execute § 3's round-budget halt: report it; the fix is the stamp it names, on Lachy's word, and
nothing is handed back until that reads. A usage limit that kills an agent mid-run is an infra block, never a quota
block: it gets the infra cool-downs and the budget, then Lachy.

**Classed before the answer.** § 2 classes each task on the state § 1's diagnosis read. A § 3b answer changes what
`inputs` reads (removing `## Needs you` can turn it to `autoRetry: true`), and the hand-back that follows his answer
is the fresh automatic-retry stretch he chose (ADR 0033 decision 6: the counters cleared, `auto_retry_sha`
stamped). So never re-class a task after recording his answer, and never skip that hand-back because a re-read says
`autoRetry: true`; the one exception is § 3b's race check.

**Rungs (ADR 0029).** A Rung drift (status § 3) is never input-gated and needs no write: report it with the
ladder's source. The task's next call starts on the top rung, and reconcile overwrites the stamp with the rung
it reaches. How a block on the top rung is triaged stays open (ADR 0029 Consequences).

**A refused ladder** (status's Ladder refused flag). Repair never edits `~/.config/thread/ladder.toml`; under
it, § 3's vault work, § 4's hand-back routes (the `hand-back` re-entry verb and its relabel and raise writes, none of
which start an agent) and § 5's defers (on Lachy's choice) still run. Repair stops at § 4's **Hand-off**: no
execute loop and no § 6. Name the file and the line its error gives, and say the queue resumes at the next
`/thread:execute [[<rollout>]]` once the file reads.

### 3. Act on what doesn't need a task call

**3a — merged, never marked → `resume`.** Only when no lead is live, no pause stands or drains, and **no RACE /
UNVERIFIED escalation is undecided** (§ 3c):

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py resume --rollout <rollout-note>
```

`resume` works on the whole rollout, not one task: for every unmarked note with a `pr:`, it asks gh for the
PR's state and base, flips one merged into the default branch to done (stamping `merged:`), and reports
anything else unchanged. A PR merged into another base is left alone, so it is escalated (§ 3c), never
flipped. An undecided RACE / UNVERIFIED task is merged into the default branch too, and only Lachy's
decision moves it: hold `resume` until § 3c records it. An exit 3 here (a `HOLD:` line) means § 2 missed one:
escalate it (§ 3c). Under a pause or a live queue, report it and leave it: the reinstate's or the lead's next
*Cold resume* runs `resume` first, and § 1 sends Lachy there only once every RACE decision is recorded.

**3b — input-gated → capture + inject.** Ping the user only here and for the other decisions no agent can
make (a gate, a § 3c escalation, a CLOSED PR, a missing branch or a missing `pr:`, a close-out, a defer chain, a
set-aside whose automatic retry is over (the auto-retry budget is spent, the fingerprint repeated, or `needsHuman` is
set) or whose `autoRetryWhy` names another cause that is his (§ 2), or a descope the verb refuses: § 3d's exit 3,
with its `ASK:` line quoted). For each input-gated task, `AskUserQuestion` with the specific decision its feedback
needs: quote the feedback and `autoRetryWhy` (`prUrlError` for an `autoRevise: true` task, whose why names the
seeded revise), and offer the raise (§ 4) where one applies. Then write the answer into the **task note body** so
the next agent reads it: replace the placeholder in place, or append or update a `## Repair input` section with the
decision verbatim. It is body content, not a status transition, so it is allowed under a pause. Where hand-back
may run (§ 1), hand the task back on his answer (§ 4).

*Answer already recorded.* Before asking about a set-aside at its run or at Integration, look for an answer
recorded for its current block: a `## Repair input` entry `needs you (block <fingerprint>)` whose `<fingerprint>` is
`inputs`' `fingerprint`, while the note's `auto_retry_sha:` is absent or differs from it. A hand-back or an
automatic retry stamps `auto_retry_sha` with the block it re-enters, so an equal value means that block was
re-entered since the answer, and an identical re-block goes back to Lachy (ADR 0033 decision 6). A `-` entry never
counts. With one found, never ask again: where hand-back may run (§ 1, § 4), repair hands back without asking again,
and that is the task's one hand-back. An answer recorded on a block already re-entered (its why `same feedback as
the block last re-entered`) never counts: ask again and quote it, so his word can be the answer.

*The needs-you flow*, for any set-aside whose note holds a `## Needs you` question (status's `needsHuman`), at its
run, at Integration or at a gate:

1. Ask the question verbatim, quoting the latest feedback.
2. Note the note's `auto_retry_at:` (absent counts as a value), then append
   `- <YYYY-MM-DD> needs you (block <fingerprint>): "<the question, verbatim>" → <his answer, verbatim>`
   to `## Repair input`, where `<fingerprint>` is `inputs`' `fingerprint`, or `-` when it is null, as at a gate.
3. Remove the `## Needs you` section, in every mode. It is body content, not a status transition, so a pause allows
   it as it allows the answer. Execute's verdict reads a non-empty `## Needs you` as open (`needs a human`), and
   neither `hand-back` nor a lead-written row (a dead call) clears it.
4. Then, where hand-back may run (§ 1), hand it back at its stage (§ 4): its class was judged before the answer
   (§ 2). A gate takes `approve-gates` on sign-off instead, with the answer and the removal first: a signed task
   takes no `## Repair input`. A hand-back that re-enters a revise with no round left also asks the raise (§ 4, on
   his word). Under a pause or a drain nothing more happens: the reinstate's automatic retry re-enters the task
   with the answer in place if its verdict allows; otherwise a later repair run finds the entry and hands back
   without asking again.
5. *The live-queue race.* The live lead can re-enter the task after step 3. Just before `hand-back`, re-read the
   note's `auto_retry_at:`: a value other than the one step 2 noted means the lead's automatic retry re-entered it
   (and it may have blocked again), so skip the hand-back. Otherwise, if `hand-back` then exits 1 with
   `status is 'in_progress'` (for an Integration one, `status is 'review'`), the lead won the race. That is no
   error. Either way, report it as re-entered by the lead (its `## Notes` `auto-retry:` line): the answer is in
   `## Repair input`, a budget slot was spent instead of a fresh stretch starting, it counts as the task's hand-back
   (§ 4's Leash), and a new block is asked afresh.

A gate is presented verbatim; on Lachy's sign-off run
`python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py approve-gates --tasks <slug>`
(execute § 3.7), never under a pause: the next `next` restarts it. A declined gate is deferred (§ 5) or left
set aside.

**3c — a possible PR-less merge, RACE / UNVERIFIED, and a merge into another base → escalate with
evidence.** For each one, show:

1. the slug, the note's `status:`, `owner:` and `started:`;
2. `gh pr view <n> --json state,mergedAt,mergeCommit,baseRefName,headRefName`;
3. whether the merge commit is on origin's default branch: `git -C <repoPath> fetch origin`, then
   `git -C <repoPath> merge-base --is-ancestor <mergeCommit.oid> origin/<default branch>` (resolve the default
   branch with execute § 4's resolver);
4. `git -C ~/repos/obsidian log -p -n 3 -- Work/Tasks/<slug>.md`: a committed version carrying `pr:` or
   `status: done` means the note was reverted or clobbered (say so if there is none);
5. for a RACE only, the lead's re-verify verdict, so Lachy decides with it on screen: the owner session's halt
   reason (`RACE: origin/<default> fails the verifier`), and the verdict file
   `<repoPath>/.claude/integration/race-<slug>.rc` (`0` green; any other rc red, `124` a timeout; absent: it
   never finished, which reads as red) with the tail of `race-<slug>.log` beside it. An UNVERIFIED task was
   never re-verified: say so.

Then append a dated `## Notes` line to the rollout note (create the section if missing), e.g.
`- <YYYY-MM-DD> repair: [[<slug>]] possible PR-less merge (PR #<n>, head audit-fix/<alias>, MERGED) escalated;
evidence shown; decision left to Lachy.` Repair never writes that task's `status:`. Then, per class:

- **A possible PR-less merge.** On Lachy's confirmation that the PR is this task's, write `pr: <url>` on the
  task note:
  - with no lead live and no pause: run `resume` (§ 3a), which re-checks the state and the base and flips it
    done;
  - under a stamped pause, or a drain nothing is draining: leave `resume` to the next *Cold resume* (the
    reinstate's, or the one that resumes the drain);
  - while a lead is live (a live queue, or a drain it is draining): escalate and record only; the `pr:` write
    is a lead-held note (§ 1) and waits for the pause stamp or the lead's end (advise: hard-pause, or wait for
    the stamp, then repair).
- **RACE / UNVERIFIED.** Never re-call merge-task: main's state is Lachy's call. Until a dated
  `- <YYYY-MM-DD> repair: [[<slug>]] RACE decided: <his decision, verbatim>` line on the rollout note's
  `## Notes` records it, the escalation is **undecided**: neither § 3a nor § 4's hand-off runs. Nothing but
  the decision moves the task: `resume` skips it (exit 3), `hand-back` refuses it (exit 2), and execute halts
  on a RACE once its lane is free and holds an UNVERIFIED task set aside. Once that line is written, `resume`
  flips the merged task done. The line is a rollout-note record, so repair writes it in every mode (§ 1),
  and a reinstate or a resume waits for it. If he decides the merge does not stand, defer the task (§ 5; its
  PR is merged, so the retire block's `gh pr close` is skipped) before recording it, so `resume` never reads
  it as landed. That defer is a lead-held note (§ 1): while a lead is live, append his decision to the
  escalation line as `defer pending` (never as `RACE decided:`), and the defer, its `RACE decided:` line and
  the hold all wait for the lead's end. A later repair run with no lead live, or under a stamped pause,
  applies the recorded `defer pending` decision without asking again: the § 5 defer, then the `RACE decided:`
  line. Until then no `RACE decided:` line exists, so status still reads it as an open escalation.
- **Merged into another base.** `resume` leaves it unchanged, and repair never hands it back, defers it or
  re-calls merge-task for it: whether the work reached the default branch (the ancestry check above shows it)
  and what becomes of the task are Lachy's call. Escalate, record, and leave it.

**3d — a settled plan-block → descope.** A `plan-blocked` task whose feedback centres on one part of the task
that the note marks optional ("consider", "optionally", "nice to have") or that a later task in this rollout owns
or replaces (§ 2's **plan-blocked, descopable**) is descoped without asking Lachy. It runs wherever `hand-back`
may (§ 1): never under a pause, and under a live queue only on a set-aside task (the live lead runs the same verb
itself, execute § 4.5, so a second run is a harmless `[no-change]`). Judge the part from the feedback and the note,
then:

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py descope --tasks <slug> --rollout <rollout-note> --part "<a verbatim quote>" (--optional --short <kebab> | --owner <owner slug> --owner-quote "<a verbatim quote from the owner's note>") --reason "<one line>"
```

Exit 0 → § 4's `hand-back` → its own call. The verb wrote every record: the follow-up note (an optional part, a
loose `<project>-followup-<short>` task with `descoped_from:`), the task's `## Scope decision (automatic)` entry
and its `<!-- descope run=… -->` marker, a pointer on the brief item (or a pointer line for a part the brief
lacks), an `(automatic)` `## Repair input` line naming the superseded Plan-blocked feedback runs,
`descope_armed:` (consumed by the restart's `mark-started`) and the rollout's `## Notes` line
(`- <YYYY-MM-DD> descope: [[<slug>]] …`). So tell Lachy afterwards, in the report, never before: the part, the
follow-up or the owner, and the undo. **Undo**, on his word, removes every one of those records: on the task
note the `## Scope decision (automatic)` section (entry and marker: a marker left behind makes the next block
read as a second one), the brief pointer or pointer line, the `(automatic)` `## Repair input` line and
`descope_armed:` if it still stands; the follow-up note set to `status: dropped`, so nobody picks up the
descoped work twice; and the rollout's `## Notes` `descope:` line removed (or rewritten as `descope undone:`),
so no report's `Descoped:` line or the Completion log lists it. Then hand back. Exit 3 → § 3b: its `ASK:` line
says why (required scope, an ADR decision, a recorded decision, an owner that cannot take it, a part tied to
neither the feedback nor the brief, or a second block after an automatic descope) and nothing was written.
Exit 1 → report its ERROR line and leave the task set aside. In this session § 3d's judgement is the session's for
that key (execute § 4.5 step 1.2's *Automatic descope* key): the hand-off's loop neither judges it again nor, after
an exit 3, retries it automatically; the refusal is § 3b's.

The verb checks the judgement mechanically, verbatim only. An `--owner` part must appear word for word in the
latest `## Plan-blocked feedback` run or in the brief, so a paraphrase of required scope asks; but a paraphrase
the feedback itself uses still passes, and only the caller's judgement guards that case. A brief's marker words
count only in their own clause (split at `.`, `;`, `:`, a dash and `, and` / `, but` / `, then`), a negated
one ("not optional") is none, and a part in a fenced code block always asks.

**3e — a git-env trip → the evidence, then Lachy's ack.** Status's Git-env trip flag (`gitEnvHold` non-empty)
means execute's canary saw the shared checkout change during a window, and the whole queue is held (execute § 4.5
*Git-env canary*). R is the rollout's `Project root:` and B the branch the trip lines name: the canary refuses any
other (exit 2). Show the evidence first:

1. the unacked `## Git-env log` lines, verbatim. One culprit can trip several windows, and a `record missing`
   trip on a call launched before the canary shipped is the upgrade case, not a culprit;
2. `git -C R rev-parse --is-bare-repository`;
3. `git -C R config --show-origin --show-scope --get-all core.bare`;
4. `git -C R for-each-ref --format='%(objectname)' refs/heads/<B>`: the sha shown, which `--ref` and `--drop-local`
   pass;
5. `git -C R reflog -n 10 refs/heads/<B>`;
6. `git -C R reflog -n 10 refs/remotes/origin/<B>`, plus `git -C R ls-remote origin refs/heads/<B>` against
   `git -C R rev-parse origin/<B>` (a forged tracking ref shows here);
7. `git -C R log --oneline --stat origin/<B>..<B>` and `git -C R log --oneline --stat <B>..origin/<B>`;
8. `git -C R ls-remote --heads origin`.

If a window is still in flight (a Workflow call or a background Integration command of the rollout), advise a
hard pause first. Then offer (`AskUserQuestion`):

- **(a) Restore and ack**, only when no Workflow call or background Integration command of the rollout is in
  flight. When `origin/<B>..<B>` is non-empty, list those commits and mark each close-out-shaped one ("a
  close-out § 2.7 wants landed: restore drops it; choose (b) to keep it"); say all of them will be dropped but
  stay recoverable through the rescue command restore prints. Run
  `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/git-env-canary.py restore --rollout <rollout-note> --repo R --default B`, adding
  `--drop-local <the B sha shown>` only when that range was shown non-empty. Re-read and show the new sha (and
  any `git-env-rescue` line), then run
  `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/git-env-canary.py ack --rollout <rollout-note> --repo R --default B --slugs <exactly the set shown> --ref <that sha>`.
- **(b) Keep the commit and ack.** Whenever evidence item 2 reads `true`, first run
  `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/git-env-canary.py restore --rollout <rollout-note> --repo R --default B --bare-only`:
  it clears core.bare (the local and the worktree config) and moves no ref, because `ack` refuses while R reads
  bare. Re-read and show items 2 and 4. Then `ack --rollout <rollout-note> --repo R --default B --slugs <exactly
  the set shown> --ref <the sha shown>`, warning that execute § 2.7 halts the next `/thread:execute` entry (`local
  default branch is ahead of origin`) until the commit lands by PR or is dropped.
- **(c) Leave it:** the hold stands.

If `ack` exits 3 (the unacked set, the ref or the bareness changed since it was shown), re-read the evidence,
show it again and ask again. If `restore` exits 2 on its drop guard (B moved since it was shown), show the new
list and ask again; restore clears core.bare before that guard, so a refused restore never leaves R bare and (b)
stays open. Any other exit 2 names a validation failure: show it and stop. A dated `## Notes` line records
the choice: `- <YYYY-MM-DD> repair: [[a]], [[b]] git-env trip, acked at <sha>: <restored | kept>` (or `left`).

**RACE follow-on.** After a successful ack, re-run status. For each slug now in `raceHold` whose `## Race log`
carries a `git-env halt` line, first show this evidence:

- the owner session's halt reason: the git-env one (`git-env trip: the shared checkout changed` or `git-env
  canary failed`), not `RACE: origin/<default> fails the verifier`;
- the `git-env halt` Race log line;
- the verdict file `<repoPath>/.claude/integration/race-<slug>.rc`. For this slug only, absent means the re-verify
  never ran, or was skipped or stopped by the git-env halt, not a red result; `0` means it ran green but the
  lead never acted on it.

This reading replaces § 3c item 5's halt-reason reading for this slug only. Then go straight to § 3c in this run:
Lachy decides once, and § 4's hand-off waits for that decision, as § 3c already requires.

### 4. Hand back: re-enter at the stage it stopped

Repair hands back only on Lachy's answer (§ 3b), this run's or one recorded for the task's current block, and after
§ 3d's descope. Every route uses execute's own re-entry verb, and never under a pause (§ 1):

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py hand-back --tasks <slug>
```

Set aside at Integration → `review` with `ready:` restamped: it rejoins the Integration queue, and nothing
before Integration is redone. When its `## Integration log`'s last line is `integrated`, it merges through
case (ii) when main has not moved since that Integration; otherwise `prepare` integrates it again (verify or
trouble). Set aside at its run → `in_progress` with `owner:` cleared: the next `next` restarts it through
execute's *Restart routing* (`resumeAt: revise` → a seeded revise, else its own call). A `stashed: integration
leftovers <head>` line in a merge log is informational: the merge step already moved the leftovers aside, so
there is nothing to clear. Per stage:

- **Stale anchor ref** (a reason starting `merge step STOP: stale anchor ref <X>`): delete it first, guarded,
  `git -C <repoPath> update-ref -d refs/integration-anchor/<inputs.branch> <X>` (an absent ref is a no-op), then
  hand back.
- **The raise, on Lachy's word** (review-blocked, its last log line `rejected`), never silently: offer it with the
  task's § 3b ask. On his word, when the resolved `max_review_rounds` (task → rollout → rollouts.toml / built-in,
  execute § 3) is ≤ `lastRound`, write `max_review_rounds: <lastRound + 1>` on the task note. Announce it in the
  report and record it in a dated `## Notes` line
  (`- <YYYY-MM-DD> repair: [[<slug>]] max_review_rounds raised to <N>, one round`), then hand back. Execute's
  automatic retry already raises one round per retry that re-enters a revise with no round left, with this
  `## Notes` wording (ADR 0033 decision 7), so a further raise is only on Lachy's word. With no `rejected` line it
  is its own run: no raise.
  When `max_review_rounds` is absent at both levels and `rollout-settings.py --repo <Project root>` exits 2 or 3,
  make no raise: report its stderr line and ask Lachy for the fix it names. A line naming
  `~/.config/thread/rollouts.toml` is fixed at that line, or by a `max_review_rounds:` stamp on the task or
  rollout note; a line naming `--repo` (the Project root is gone or its origin unreadable) only by that stamp.
  Repair never edits that file.
- **A `merge-task:` own-run set-aside whose cause Lachy cleared on GitHub** (its last log line `integrated`):
  relabel it at Integration, then hand back: nothing before Integration is redone; it merges through case
  (ii) when main has not moved. A code cause stays its own call.
  ```
  printf '%s' "<the cleared cause>" | python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/lead-integrate.py set-aside --note <task note> --kind integration | python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py reconcile --result -
  ```
- **A CLOSED PR or a missing branch** (§ 2's **PR CLOSED / branch missing**: awaiting Integration,
  integrating or set aside at Integration; input-gated). A CLOSED PR keeps its `pr:`, so `hand-back` accepts
  a set-aside note and the loop would integrate it (`prepare` never reads the PR state), only for merge-task to
  set it aside at its own run: never leave it to the loop. Offer:
  - restore: the landing-register check, a plain push of the local branch if it exists (never forced),
    `gh pr reopen`, then `hand-back` **only when the task is set aside**: an awaiting-Integration or
    integrating note is already in the Integration queue, and `hand-back` refuses it;
  - recut (below);
  - defer it (§ 5);
  - leave it.

  Under a live queue act only on a set-aside one: an awaiting-Integration task may enter the lane at any
  moment.

  A set-aside at Integration with no `pr:` (§ 2's same class) is refused by `hand-back`. Its restore first finds
  its branch's PR: `gh pr list --repo <owner/name> --head <inputs.branch> --state all --json number,url,state`.
  Then, on Lachy's confirmation, by its state: OPEN → write `pr: <url>`, then hand back; CLOSED → the restore
  above, writing `pr: <url>` after `gh pr reopen` and before `hand-back`, so the note never names a CLOSED PR;
  MERGED → § 3c's possible PR-less merge (its `pr:` write, then `resume`). The OPEN and CLOSED `pr:` write runs
  wherever `hand-back` may (§ 1), a live queue included: no live call owns a set-aside note, so no reconcile
  overwrites it, and it goes with the hand-back that follows it. Once its `pr:` reads, the live lead's automatic
  retry may re-enter the task first: `hand-back` then exits 1 with `status is 'review'`, which is no error (§ 3b's
  live-queue race). With no PR for its branch, the options are recut, defer or leave.
- **Recut, only on Lachy's explicit ask:** a fresh start from the queue's current base.
  1. Run the landing-register check (execute § 2.5).
  2. Retire the branch with § 5's retire block plus `git -C <repoPath> branch -D <inputs.branch>`.
  3. Relabel it to its own run: the same pipe as above with `--kind own`.
  4. Run `hand-back`. Its old `## Integration log` lines survive and are harmless.
- **Leash:** repair re-enters a task on its own judgement only through § 3d's descope, once per task per repair
  run; every other hand-back follows Lachy's answer (§ 3b). `hand-back` starts a fresh automatic-retry stretch (the
  counters cleared, `auto_retry_sha` stamped), so the lead's retry has its budget again and an identical re-block
  comes straight back to him. A task that blocks again in this run is surfaced with its new diagnosis and three
  offers: *more guidance and one more hand-back*, *defer it* (§ 5), or *leave it set aside*. Don't loop.
- **Hand-off, when no lead is live and no pause stands**, and never while a RACE / UNVERIFIED escalation is
  undecided (§ 3c; report the hold and stop there), a git-env hold stands (§ 3e; report it and stop there) or
  the ladder file is refused (§ 2; name the file and stop there): execute's queue loop, entered at its §4.5 resume
  (*Cold resume*): execute § 2.5 first (then § 2.6), then execute § 3's `verify_timeout` check (a halt there
  writes nothing), then the canary's `check-all` (execute § 4.5 *Git-env canary*; a non-zero exit halts), then
  `reconcile-rollout.py resume`, then the loop with
  `--running ""` (this session holds no task call). Execute's § 2.7 pushed-base gate (entry points only)
  does not run on this hand-off; the next `/thread:execute [[<rollout>]]` runs it. Under a live queue the
  hand-backs are enough: the live lead's next `next` picks them up.

### 5. Defer a wedged task (dependency-aware)

When the user opts to defer a task (or declines further retries on a re-blocked one):

1. **Compute the dependent closure.** From the status task list, every task whose `depends-on:` or
   `blocked-by:` names this task, transitive (a dependant's dependants too), followed through `merged_into:`
   tombstones (a task folded into this one counts as this one).
2. **No dependants** → **clean defer**. The retire block:
   ```
   git -C <repoPath> worktree remove -f -f <repoPath>/.claude/worktrees/<slug>   # if it exists; -f -f: execute locks task trees against the reaper
   gh pr close <pr> --delete-branch --comment "deferred out of [[<rollout>]] — back to backlog"   # if a PR exists
   git -C <repoPath> update-ref -d refs/integration-anchor/<inputs.branch> <X>   # if the ref exists; <X> is its current value
   ```
   then:
   ```
   python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py defer --tasks <slug> --rollout <rollout-note>
   ```
   then delete the task's `## Queue` row and its `## File-sets` line from the rollout note, and write a dated
   `## Notes` line (`- <YYYY-MM-DD> repair: [[<slug>]] deferred: <reason>`). `defer` clears `rollout:` and
   `owner:` and the run stamps and sets `status: open`, so a future `/thread:schedule` re-plans it. The
   `gh pr close --delete-branch` is **not gated on the landing register**, on purpose: it only removes the
   rollout's own branch and PR from a task the user chose to defer, and lands nothing on the default branch,
   so it is cleanup like a pause (`execution-fit.md` § Dispatch blockers, *Landing register*).
3. **Has dependants** → **ask**: *"[[B]], [[C]] depend on [[A]]: defer the whole chain, or keep and fix
   [[A]]?"* Defer the chain → A and its closure, each through the clean defer. Keep and fix → back to § 3b or
   § 4 on A. A dependant already running or integrating under a live lead → ask, and never write it.

### 6. Run the queue to completion + log

Follow execute's loop from the hand-off (§ 4) until it halts or completes, with the same stop conditions as
execute. This hand-off enters execute's §4.5 resume directly, so execute's § 2.7 pushed-base gate (entry
points only) does not run; the next `/thread:execute [[<rollout>]]` runs it. Execute's **completion
ceremony** then runs on the (possibly reduced) task set. Ensure the rollout's `## Completion log` records
every repair action, copied from the dated `## Notes` records this and earlier runs wrote: hand-backs (task +
stage), decisions injected (task + value), needs-you answers (task + question + answer, read from each task's
`## Repair input` `needs you` entries), gates signed, raises (task + new budget), automatic descopes (task +
part + follow-up or owner) from the `descope:` lines, whoever wrote them (§ 3d or the live lead),
merged-never-marked tasks flipped by `resume` (task + PR), tasks deferred (task + reason + dependants moved with it), a CLOSED PR or
missing branch (task + restore, recut, defer or leave), and the escalations of § 3c with Lachy's decisions:
possible PR-less merges, RACE / UNVERIFIED (task + PR + the re-verify verdict + the recorded decision), and
merges into another base (task + PR + base), and each git-env trip (§ 3e: the trip lines, the evidence's sha,
the choice, any restore and its rescue line, and the ack line).

## Don'ts

- **Don't treat `paused:` or `pause_requested` as drift.** A pause is intentional (§ 1): repair never clears
  the stamp or the flag, never hands back, never runs `resume` or the loop under either; reinstate, for a
  stamped pause only, is `/thread:execute [[<rollout>]]`.
- **Don't act on a live queue's running or integrating note.** No `resume`, no loop, no write to it, even
  when an empty `/workflows` was seen from a session other than the owner's.
- **Don't re-implement Integration, merge or convergence.** Set-aside → `hand-back` at its stage; merged,
  never marked → `resume`; everything else → execute's loop. If you're writing a start, integrate or merge
  loop, you've turned the conductor into an engine: stop.
- **Don't merge anywhere but execute's merge step.** No inline `gh pr merge`, no `--admin`, no force-push.
  The engine keeps sole merge authority (README → *Coexistence with Orca*).
- **Don't redo what a set-aside task already finished.** At Integration, retry Integration only; a recut is
  only on Lachy's explicit ask.
- **Don't descope by hand, or twice.** `reconcile-rollout.py descope` (§ 3d) writes every record and refuses a
  second block after a restart (exit 3): ask Lachy then (§ 3b), and never hand the task back on a refusal. A
  task plan-blocked again after an automatic descope is § 2's **plan-blocked after a descope**, never an own
  run handed back silently.
- **Don't hand back what the lead retries.** A set-aside that `inputs` reads as `autoRetry: true`, or cooling
  (`autoRetryAfter`), is the lead's (§ 2's **retry (automatic)**, judged before any answer), and a hand-back would
  reset its budget. A hand-back on Lachy's answer is never this case: it is the fresh stretch he chose. Ping Lachy
  only once its automatic retry is over (the auto-retry budget spent, the fingerprint repeated or `needsHuman` set),
  when `autoRetryWhy` names another cause that is his, and for gates, escalations, a CLOSED PR, a missing branch or
  a missing `pr:`, a defer chain or a refused descope.
- **Don't hand back an answered question with its `## Needs you` still in place.** Remove the section once the
  answer is in `## Repair input` (§ 3b): neither `hand-back` nor a lead-written row clears it, so the verdict would
  read the answered question as open and never retry the task.
- **Don't write a PR-less, RACE / UNVERIFIED or other-base task's `status:`**, and never re-call merge-task
  for a RACE.
- **Don't run `resume` while a RACE / UNVERIFIED escalation is undecided.** Not in § 3a, not through § 4's
  hand-off, and never send Lachy to a reinstate or a `/thread:execute` resume before its `RACE decided:` line
  (§ 3c). The line itself is a rollout-note record, so no pause or live lead holds it back (§ 1).
- **Don't touch a signed task while its lead is live.** After `approve-gates`, its owner session holds the
  signed-gate handle (execute § 3.7): no hand-back, recut, defer, re-plan or `## Repair input` (§ 2).
- **Don't ack a git-env trip unseen.** Never ack trips or a ref Lachy was not shown (`ack --slugs` is exactly the
  set shown, `--ref` the sha shown), never restore with anything in flight (`--bare-only` aside: it moves no ref), and never pass `--drop-local` for
  commits Lachy was not shown (§ 3e).
- **Don't escalate a RACE re-verify in flight.** The lead decides it itself (§ 2). Asking Lachy before its
  verdict exists invites a "stands" that a red re-verify then contradicts.
- **Don't reinstate a rollout another rollout's `supersedes:` names.** Its unlanded tasks were carried there;
  finish its close-out instead (§ 1).
- **Don't defer a task with dependants alone.** Compute the closure first; defer the chain or fix it.
- **Don't loop.** One hand-back per task per run (§ 4's Leash); then surface and let the user decide.
- **Don't run repair under the built-in `/loop` (and never suggest it).** Repair is input-gated by design: it
  asks the user decisions no agent can make, so an unattended loop would either hang on the question or
  steamroll it. Unattended driving belongs to execute (§8: the Stop-hook driver + heartbeat cron) and status
  (read-only sweeps); repair stays a hands-on verb.
