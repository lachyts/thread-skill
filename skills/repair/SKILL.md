---
name: repair
description: 'Use to unstick a stalled rollout: any issue with the whole rollout, not a single task. Triggers on "repair [[rollout]]", "fix this rollout", "[[rollout]] is stuck", "sort out [[rollout]]", "unblock the rollout", or after /thread:status shows blockers/drift. A thin CONDUCTOR over /thread:execute (never a second engine): it diagnoses (runs /thread:status), reconciles drift, asks YOU only the decisions no agent can make and records them, leaves agent-fixable blocks to execute, dependency-aware-defers wedged tasks, then hands off to execute''s resume or starts a serial chain''s next Leg — the engine keeps sole merge authority. Scope: Obsidian + gh/git + the execute engine + the Chorus Stage.'
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

**Plugin root.** A command taken from text read as a file (a plugin file this skill sends you to, or this SKILL.md itself when a router or `sed` reads it instead of the Skill tool rendering it) runs by `${CLAUDE_PLUGIN_ROOT}/skills/_shared/plugin-root.md`.

## Native runtime binding

Diagnosis and authorised deterministic reconciliation (the hand-backs, the notes writes) run in either
harness. Any task call goes through execute's native runtime preflight and its canonical engine, with the
original run's caller/session and native child identities. Read
`~/repos/workspaces/_shared/scripts/native_workflow.md`. A new harness must not adopt or replay another
session's pending claims. Recover the actual native children first; otherwise report the unresolved
ownership. Codex has no detached driver: repair preserves the diagnosis and the hand-backs, and the queue can
then run only as a session-driven `--gated` run. Do not claim that a request for continuous repair has been
completed by preparing one. Never create a second convergence engine. A serial chain (§ 7) makes no task call. Its
`create_thread` opens a new visible Session that runs `/thread:execute` itself, as `skills/execute/legs.md` § Hand over
does. There is no engine preflight, no native child and no claim adopted: the new Leg's `begin` takes the chain
under leg.py's lock. The host tool is the one `skills/execute/legs.md` § Hand over picks: the Chorus Stage's for a
claude launch, Codex Desktop's own per /thread:handoff for codex, and a manual handoff otherwise.

## Scope

Reads/writes `~/repos/obsidian/Work/Tasks/`, makes `gh`/`git` calls against the target repo, and drives
`/thread:execute`'s queue loop, and, at a close-out's finish (§ 1), `close-score.py`: it writes fold-journals'
`call-journal` lines and one `tunings.jsonl` line under the events directory, outside the vault, and reads every
note under `Work/Tasks/` (Archive included) and the Project root's git, read-only and never fetched. Merges only
ever happen through execute's merge step (`merge-task.sh`). On a serial chain (§ 7) it runs `leg.py status`
(read-only), `leg.py restarted` and, on Lachy's word, `leg.py clear-halt`. These are the only Leg-log writes it makes,
under leg.py's lock. It also runs the task-note verbs `approve-gates`, `record-answer`, `hand-back` and `defer`, a
read-only `git status --porcelain` in the chain's checkouts, and the Chorus Stage's `list_sessions` and
`create_thread`, which starts a new Session. It makes no `gh` call and no task call there.

## Invocation forms

```
/thread:repair [[giflab-rollout]]      # diagnose, fix what it can, ask only the decisions, run the queue to done
repair [[giflab-rollout]]            # natural language — same thing
fix this rollout                     # resolves to the rollout in context
```

## Skill flow

### 1. Diagnose

Resolve `[[<slug>]]` (ask if ambiguous): `~/repos/obsidian/Work/Tasks/<slug>.md`, else
`Work/Tasks/Archive/Rollouts/<slug>.md`, a rollout whose completion ceremony already ran (§ 3a's
complete-rollout stop). Run the **`/thread:status` scan with the live cross-check on**
(repair is about to act, so it always checks reality): the per-task queue state, each task's
`lead-integrate.py inputs`, the drift flags and the repo path. On a `shape: serial` note the scan is status § 5's
`leg.py status` instead, with no live cross-check: a chain has no PRs and no lead. Show the user the situational
report first: they should see what they're repairing.

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
    one still here would be stranded, so show it and stop). Run
    `python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/close-score.py --rollout <this rollout note> --close supersede`
    first, with the Bash tool's `timeout: 600000` (ADR 0037 d4; report its line; a non-zero exit is reported and
    the close-out goes on), then stamp `status: done` and `superseded_by: "[[N]]"` on this rollout note, then
    `mkdir -p ~/repos/obsidian/Work/Tasks/Archive/Rollouts/` and a plain `mv` of the note into it. A same-named
    file already there → skip the move and report the collision. Write nothing else in the vault: close-score's
    `call-journal` lines and its one `tunings.jsonl` line, both under the events directory, are its only other
    writes. Stop, and point at `/thread:status [[N]]`.
- `protocol_version` absent, `2` or `3` → execute § 2's remedy: hard-pause it if a session is running it, then
  `/thread:schedule <project> --regenerate`. Stop.
- any other value except `5` → "unsupported protocol version <N>; the queue reads protocol_version: 5". Stop.
- `incomplete` → `/thread:schedule <project> --regenerate`; on a `shape: serial` note, which nothing supersedes,
  stamp it `status: dropped`, then `/thread:schedule --tasks <its tasks>`. Stop.

**A serial chain.** After the Stops, a `shape: serial` note (read from the note, as status § 1's **Shape** reads
it) goes to § 7, instead of the modes below and §§ 2–6.

Then one of three modes holds, each evaluated before anything is written: a pause, a live queue, or no lead
live. Two rules cut across them.

**In every mode**, on Lachy's confirmation where § 3 asks for it, repair may write what no live call reads or
overwrites, because each is independent of the pause and the lead:

- § 3c's escalation and its record: the evidence, the dated `## Notes` line on the rollout note, and, once
  Lachy decides a RACE / UNVERIFIED, its `RACE decided:` line. That line is what lifts the hold on `resume`
  (§ 3c), so neither a pause nor a live lead holds it back; only a decision that the merge does not stand
  waits, for its defer (a lead-held note, below).
- § 3b: an answer recorded with `reconcile-rollout.py record-answer` (the only writer of a `## Repair input` answer,
  block-keyed so a later run, status and the lead find it). Its one save carries, the entry last, the removal of the
  `## Needs you` section it answers, a `--raise <field>` on Lachy's word and a confirmed `--pr`.
- § 5: a defer of a set-aside task with its queued dependants.
- § 3e: the git-env ack, on Lachy's word. The canary's `ack` writes only the rollout note's `## Git-env log` and
  its own records, and it re-baselines a live window rather than overwriting a note. § 3e's `restore` is not an
  every-mode write: it waits until nothing of the rollout is in flight. Its `--bare-only` form, which moves no
  ref, runs with (b)'s ack.

**Lead-held notes.** § 3c's `pr:` write and § 3c's defer of a RACE / UNVERIFIED task whose merge Lachy decides
does not stand write a task note a live call's reconcile would overwrite. They run only when no lead is live
(every owner session has ended, or shows no run there under no room-stop headline, neither the standing
`ROOM STOP since <stamp>` nor the lapsed `room stop since <stamp> lapsed`, a drain nothing is draining
included) or under a stamped pause, where no call is live; otherwise they wait for the stamp or the lead's end.

**Pause, drained or stamped.** While `pause_requested` drains, or `paused:` stands:

- Repair reports the pause. Stamped → "reinstate with `/thread:execute [[<rollout>]]`". Pending → "it drains;
  nothing to do" while a lead is live (the owner check below, under which a room stop counts as live); with
  none, nothing is draining it, so `/thread:execute [[<rollout>]]` resumes the drain. Either way, point at `/thread:execute` only once every
  RACE / UNVERIFIED task has its `RACE decided:` line: its *Cold resume* runs `resume` first.
- Beyond the every-mode writes it never runs `hand-back`, `approve-gates`, § 3d's `descope`, a raise beyond the one
  an answer's entry carries, `resume` or the loop, and it never clears the stamp or the flag.
- One exception, the sign-off pause (ADR 0034): under a stamped pause whose `paused_for` is `sign-off` (execute
  § 4.5 step 5's form: the run finished everything else and closed, and nothing is live), repair may also run
  `approve-gates` on Lachy's sign-off, and `defer` a waiting task he declines; then "reinstate with
  `/thread:execute [[<rollout>]]`". Every other pause is unchanged.
- Why: `next` stamps `paused:` only once nothing runs, awaits Integration or integrates. A hand-back during the
  drain would put a task back into exactly those states, and the live lead would integrate and merge it after
  Lachy asked to pause. Under a stamped pause, the reinstate decides what restarts.
- The lead-held notes above run under a stamped pause (and under a drain nothing is draining), each leaving
  `resume` to the next *Cold resume*.

**Live queue, not paused.** A running or integrating task carries an `owner:` whose session is not known to
have ended. A Workflow run is listed only in the session that launched it, which the tag names, so check
`/workflows` in that owner session; from any other session "no run" proves nothing, so report "possibly live:
check session `<owner tag>` first". A room stop, standing or lapsed (the scan's `ROOM STOP since <stamp>` or
`room stop since <stamp> lapsed` headline, status § 4's *Room stop*), is a live queue too while its owner session
has not ended, even with no run there and whatever its tasks read: its calls are room-stopped, the Chorus Stage
owes a standing one's resume and the owner's heartbeat re-enters a lapsed one (execute § Room stop), each
resuming them by handle. Any loop entry from here would end it, on a Login that may still be at its line, and give
each task a fresh call beside that resume: two calls per task.

- Beyond the every-mode writes, repair may hand back a set-aside task once Lachy has answered it (§ 3b), never one
  § 2 classes **retry (automatic)** (§ 2 classes it before any answer: a hand-back on his answer is the fresh
  stretch he chose). It may also run § 3d's `descope` on one (wherever `hand-back` may run), run `approve-gates` on
  sign-off (the raise goes in through `record-answer --raise`), and write the `pr:` § 4's restore finds for an
  at-Integration set-aside with no `pr:`: no live call owns a set-aside note, so that write goes with the hand-back
  that follows it (§ 4). It writes that `pr:` through `record-answer --pr`, and the spend is the `hand-back` verb's
  own.
- It never runs `resume`, never enters the loop, and never writes a running or integrating note, because a
  live call's reconcile would overwrite it: the lead-held notes wait for the lead's end.
- A RACE re-verify in flight (§ 2) is the lead's: report it and wait. It becomes a § 3c escalation only once
  its owner session shows the `RACE: …` halt or no run, or has ended. A git-env halt ends it too: a `## Race log`
  line naming it that carries `git-env halt`, or the owner session's `git-env trip…` / `git-env canary failed`
  halt, makes it a § 3c escalation (§ 3e hands it there).
- The live lead's next `next` restarts an `in_progress` hand-back and integrates a `review` one.

**No lead live.** No pause, and every owner session has ended (or shows no run there, under no room-stop
headline, neither the standing `ROOM STOP since <stamp>` nor the lapsed `room stop since <stamp> lapsed`): the
full flow, § 3 to § 6, except that an undecided RACE / UNVERIFIED escalation holds every `resume` and the hand-off (§ 3c).

**Sent here by schedule's unfinished-rollout refusal.** Repair sorts out what is stuck; superseding stays
schedule's `--regenerate`. A refusal line `<P> is named by the supersedes: of <N>, which has since run` is
the **Close-out interrupted** stop above: run `/thread:repair [[<P>]]`, and on Lachy's confirmation it closes
P out, so schedule's check no longer counts P.

### 2. Classify each unmerged task

From its queue state, its `lead-integrate.py inputs` (`resumeAt`, `autoRevise`, `lastIntegration`), its verdict
(`autoRetry`, `autoRetryWhy`, `autoRetryAfter`, `autoRetryError`, `fingerprint`), `prUrlError`, `humanFix` (the one act
that moves a block only Lachy may move, ADR 0035: repair reads it and never re-derives a cause) and `answerRecorded`
(the live answer to the current block, the one read status and the lead share), status's
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
| **PR CLOSED / branch missing** | awaiting Integration, integrating (no lead live) or set aside at Integration, and its PR is CLOSED unmerged (status's flag) or `git -C <repoPath> ls-remote --exit-code --heads origin <inputs.branch>` finds no branch; or set aside at Integration with no `pr:` (`humanFix.act` `restore, recut or defer` with no `pr:`), which `hand-back` refuses | input-gated: § 4's restore, recut, defer or leave; never left to the loop, which would integrate it only for merge-task to set it aside at its own run; with no `pr:`, restore starts by finding its PR (§ 4) |
| **awaiting Integration** | `review` with a `pr:` | nothing: the loop integrates it |
| **queued** | `open`, its `waitingOn` unmet | nothing: it starts when its dependencies land (or defer it with its blocker, § 5) |
| **plan-blocked after a descope** | `plan-blocked` with a `## Scope decision (automatic)` section and no `descope_armed:`: it restarted after an automatic descope and blocked again | input-gated: § 3b, quoting the new feedback and the automatic descope; never a silent hand-back, never a second descope (the verb refuses one, exit 3) |
| **plan-blocked, descopable** | `plan-blocked` (`resumeAt: own`) with no `## Scope decision (automatic)` section, or one whose `descope_armed:` still stands (a descope whose hand-back never ran), its feedback centring on one part of the task that the note marks optional or that a later task in this rollout owns | `reconcile-rollout.py descope` (§ 3d): exit 0 → hand back (§ 4) → its own call, and tell Lachy afterwards; exit 3 → § 3b; judged before **retry (automatic)**, as execute's step 1.2 judges a descope before its automatic retry: a refusal (exit 3) is recorded on the task note, so its `humanFix` reads `decide scope or defer` and the verdict `autoRetry: false` |
| **retry (automatic)** | set aside at its run or at Integration, and `inputs` reads `autoRetry: true` or a non-empty `autoRetryAfter`; a `plan-blocked` task reaches it only once the class above judged it not descopable | nothing: the lead re-enters it (execute § 4.5 step 1.2's *Automatic retry*), now or once its cool-down ends, and with no lead live § 4's hand-off does; never a hand-back, which would reset its budget |
| **needs you** | set aside at its run or at Integration (`setAsideAt: run` or `integration`, never a gate) with a `## Needs you` question (status's `needsHuman`) | input-gated: § 3b asks the question verbatim, writes the answer into `## Repair input`, removes the `## Needs you` section, then hands back at its stage (§ 4) |
| **at Integration** | `setAsideAt: integration` (`resumeAt: integration`) | input-gated (§ 3b): ask its `humanFix` (the act and the detail), then on his word `reconcile-rollout.py hand-back --tasks <slug>` → `review`: it rejoins the Integration queue and retries Integration only; its branch, plan and review stand, and nothing before Integration is redone (§ 4). One with no `pr:` is **PR CLOSED / branch missing**'s. An Integration conflict (`integrationBlock: conflict`) quotes its resolution brief, the latest Blocker diagnosis run, as the feedback beside its `humanFix`, so Lachy decides which intent wins or hands it back |
| **revise (automatic)** | `autoRevise: true` | nothing: the lead (or § 4's hand-off) launches the seeded revise itself; with a non-empty `prUrlError` it launches nothing, so that one is input-gated (§ 3b): its `humanFix` reads `fix the note's pr: or defer` with `prUrlError` as the detail, and Lachy fixes the note's `pr:` (`record-answer --pr`) or defers it |
| **revise stopped** | `revise stopped:` in the marker, `resumeAt: revise` | input-gated (§ 3b), then hand back (§ 4) → a seeded revise |
| **review-blocked, rejected** | `review-blocked`, `lastIntegration.outcome: rejected` | input-gated (§ 3b): offer the raise (§ 4, on his word), more guidance, defer or leave; then hand back → a seeded revise |
| **own run** | `resumeAt: own`: `blocked`, `plan-blocked`, `review-blocked` with no `rejected` line, a code-writing `review` with no `pr:`, a `merge-task:` set-aside | input-gated (§ 3b): ask its `humanFix` (the act and the detail), then on his word hand back (§ 4) → its own call. A code-writing `review` with no `pr:` is asked too (the verdict never retries it: "repair's call"): hand back, so its own call opens the PR on its branch, or defer |
| **gate** | `gate-pending` | present the gates verbatim, and its `## Needs you` question (status's `needsHuman`), if any, verbatim beneath them on a `→ asks:` line; § 3b records his answer and removes the section before any sign-off; on sign-off `approve-gates` (§ 3b); never hand back |

**A signed task is the lead's.** After `approve-gates` the task reads `in_progress` with `gates_signed:`, or
`review` from an Integration stop. While its owner session is live, that session holds the signed-gate
handle (execute § 3.7): it resumes the gate-pending call on the plan Lachy signed. Repair never hands it back,
recuts, defers or re-plans it, and writes no `## Repair input` to it. With no lead live, the next *Restart
routing* takes a fresh call behind § 3.7's warning.

**Agent-fixable is execute's now (ADR 0033).** Repair never judges a block agent-fixable from its feedback: it
reads `inputs`' verdict. A set-aside at its run or at Integration that § 2 does not class **retry (automatic)**
reaches repair because its automatic retry is over (the auto-retry budget is spent, the fingerprint repeated, or
`needsHuman` is set), or because its `humanFix` names another cause that is his: `auto_retries: 0`, an unresolved
budget, a quota block past its five free retries, a declined merge, a gone branch, a merge-task text a human must
clear, a `prUrlError`, an at-Integration set-aside with no `pr:` (**PR CLOSED / branch missing**) or a code-writing
review with no `pr:`. Either way it is input-gated (§ 3b), and the ask quotes `humanFix` (its act and its detail). A non-empty
`autoRetryError` is execute § 3's round-budget halt: report it; the fix is the stamp it names, on Lachy's word, and
nothing is handed back until that reads. A usage limit that kills an agent mid-run is an infra block, never a quota
block: it gets the infra cool-downs and the budget, then Lachy. When the limit is known to the lead's Session,
execute § 4.5 *Lost call* first resumes such a transient row once from its own run, so only that resume's row, or
the dead call's row, reaches this class.

**Classed before the answer.** § 2 classes each task on the state § 1's diagnosis read. A § 3b answer changes what
`inputs` reads (an answered block reads `answered for this block …`, its `humanFix` the answer's own), and the
hand-back that follows his answer is the fresh automatic-retry stretch he chose (ADR 0033 decision 6: the counters
cleared, `auto_retry_sha` stamped). So never re-class a task after recording his answer, and never skip that
hand-back because a re-read reads differently; the one exception is § 3b's race (the compare-and-swap).

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

**The complete-rollout stop (p19-14).** A rollout whose note reads `status: done`, or sits in
`Work/Tasks/Archive/Rollouts/`, already had its completion ceremony. When `resume`'s `progress:` line reads
`rollout complete` on such a note, repair reports the repair and stops: no § 4 hand-off and no § 6. For each task
`resume` flipped, write a dated `## Notes` line to the rollout note,
`- <YYYY-MM-DD> repair: [[<slug>]] merged, never marked: flipped done (PR <url>); rollout already complete, no hand-off`,
since no second ceremony copies it into a Completion log. Execute's loop would otherwise re-run that ceremony (a
second Completion log, thread close, cron delete and archive move); its own idempotence guard, `next`'s `halt:
"done"` on a done, archived note (execute § 4.5 step 5), is the backstop, never the route (its `done` route still
runs the thread close, the ceremony's one step after the archive commit). A done note still in
`Work/Tasks/` is a ceremony interrupted before its archive move: say so, and point at `/thread:execute [[<rollout>]]`,
which finishes it. A complete rollout whose note does not read done (its lead ended before the ceremony) is no stop:
§ 4's hand-off runs, `next` halts `complete`, and the ceremony it never ran is the hand-off's only work.

**3b — input-gated → capture + inject.** Ping the user only here and for the other decisions no agent can
make (a gate, a § 3c escalation, a CLOSED PR, a missing branch or a missing `pr:`, a close-out, a defer chain, a
set-aside whose automatic retry is over (the auto-retry budget is spent, the fingerprint repeated, or `needsHuman` is
set) or whose `humanFix` names another cause that is his (§ 2), or a descope the verb refused: § 3d's exit 3, recorded,
its `humanFix` `decide scope or defer`). For a set-aside at its run or at Integration, in order:

1. **Ask.** `AskUserQuestion` with the specific decision its block needs: quote the feedback and its `humanFix` (the
   act and the detail the script names, never a cause re-derived from the feedback), and offer the raise (§ 4) when
   `humanFix.raise` names a field, or for a revise re-entry with no round left.
2. **Prerequisites first**, only where hand-back may run (§ 1): whatever his answer needs before a bare hand-back is
   all that is left. That is § 4's push and `gh pr reopen`, a recut's retire and relabel, a `merge-task:` relabel, a
   stale anchor ref's deletion, or § 5's defer (its `## Notes` line is then the record).
3. **Record LAST, with `record-answer`**, in every mode (it is body content, not a status transition, so a pause allows
   it):

   ```
   python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py record-answer --tasks <slug> --rollout <rollout-note> --kind needs-you|decision --ask "<the ask, verbatim>" --answer "<his answer, verbatim>" --fingerprint <inputs.fingerprint, or -> [--form hand-back|awaiting-repair|left] [--raise <field>] [--pr <url>]
   ```

   It is the only writer of an answer, whatever was asked (a `## Needs you` question, a spent budget, a repeated
   fingerprint or any other `humanFix`): one task-note save, the entry
   `- <stamp> <kind> (block <fingerprint>[; awaiting repair|; left]): "<the ask, verbatim>" → <his answer, verbatim>`
   last, after the removal of the `## Needs you` section it answers, the raise and the `pr:`. `<kind>` is `needs you`
   for a `## Needs you` question and `decision` for every other ask (the verb refuses `decision` while the note holds
   a question, so no answer stands beside a stale one); `<stamp>` is the verb's (now's minute, bumped past
   the block's last re-entry and its earlier entries, so no two share a stamp and none ties a re-entry). A raise goes
   in as `--raise <field>` (the field `humanFix.raise` names, or `max_review_rounds` for a revise re-entry with no round
   left, § 4), and a confirmed `pr:` as `--pr`, never as a hand-written frontmatter edit. The form:
   - `--form hand-back` only when a bare hand-back is all that is left: the verb refuses it at Integration with no
     `pr:`, on a `prUrlError`, and on a revise re-entry with no round left and no raise;
   - `--form awaiting-repair` otherwise: while a restore, recut, relabel, ref deletion or § 3c merge is still to
     do (under a pause or a drain, where step 2 cannot run, it is whenever his answer needs one), so the lead never
     hands it back first;
   - `--form left` for "leave it": answered, never asked again and never retried;
   - no form, with `--fingerprint -`, for a block with no fingerprint (a gate, a PR-less code-writing review): a `-`
     entry never counts, so a block with no fingerprint is asked again.

   After a relabel, re-read `inputs` and record against its new fingerprint. A changed answer is recorded again, and
   the verb supersedes the old one (`(block <fingerprint>; superseded <stamp>)`): a block carries one live answer.
4. **Hand back** where hand-back may run (§ 1, § 4): `hand-back --tasks <slug> --answer <stamp>`, the stamp
   `record-answer` printed. A `-` entry hands back with a bare `hand-back`, which spends whatever is live.

*Answer already recorded.* Before asking about a set-aside at its run or at Integration, read `inputs`'
`answerRecorded`, the one read the lead and status share: the live answer to the block's current fingerprint, stamped
later than the note's last re-entry. A `-` entry never counts, nor a spent or superseded one.

- The last re-entry is the latest of the note's `### Run <n> (<stamp>)` headings, in any section, its
  `auto_retry_at:`, its `- descoped (automatic) <stamp>` entries and its `started:`: a run recorded, an automatic retry
  made, an automatic descope recorded or a new start after the answer means the task was re-entered since. A
  fingerprint is a content hash, so an earlier block's text can come back (answered, retried through two other blocks,
  then the first text again with the budget spent): a repeated block is Lachy's again (ADR 0033 decision 6), never
  handed back on the old answer.
- An entry recorded before the block's last re-entry never counts, whatever the verdict's why: ask again and quote
  it, so his word can be the answer. One recorded since counts whatever the why, a block whose fingerprint equals
  `auto_retry_sha` included (`same feedback as the block last re-entered`, or a spent budget on a repeated block). A
  tie, an unparseable stamp or two live entries sharing one fail closed: it is asked again.

With one found, never ask again; act on it by its form, where hand-back may run (§ 1, § 4):

- `hand-back`: hand back with `--answer <answerRecorded.stamp>`, once (the lead's *Recorded answer* may get there
  first);
- `awaiting repair`: finish the work it recorded (step 2: for an at-Integration set-aside with no `pr:`, which
  `hand-back` refuses, it acts on the answer as § 4's restore, recut, defer or leave), record it again with
  `--form hand-back` (plus `--pr` or `--raise`), which supersedes the old entry, then hand back with `--answer`;
- `left`: report it, and ask nothing.

*Spent on the hand-back.* The `hand-back` verb spends the answers itself: every hand-back that moves a note (§ 4,
§ 3d's included, and execute's "retry [[task]]") rewrites each live key on it, `(block <fingerprint>)`,
`(block <fingerprint>; awaiting repair)` or `(block <fingerprint>; left)`, to `(block <fingerprint>; handed back <stamp>)`
in the same save, while the task is still set aside; a refused hand-back spends nothing. A spent entry never matches
again, so the block that comes back after the hand-back, an identical one included, is asked afresh (ADR 0033 decision
6), its `humanFix.label`'s `ask <k>` making it a new item. Repair never rewrites, supersedes or spends a key by hand.

*The needs-you flow*, for any set-aside whose note holds a `## Needs you` question (status's `needsHuman`), at its
run, at Integration or at a gate:

1. Ask the question verbatim, quoting the latest feedback.
2. Do step 2's prerequisites, where hand-back may run.
3. Record it: `record-answer --kind needs-you`, its ask the question, verbatim. The verb removes the `## Needs you`
   section in the same save, in every mode. Execute's verdict reads a non-empty `## Needs you` as open (`answer the
   question`), and neither `hand-back` nor a lead-written row (a dead call) clears it.
4. Then, where hand-back may run (§ 1), hand it back at its stage (§ 4) with `--answer`: its class was judged before
   the answer (§ 2). A gate takes `approve-gates` on sign-off instead, with the answer and the removal first: a signed
   task takes no `## Repair input`. A hand-back that re-enters a revise with no round left also asks the raise (§ 4,
   on his word), recorded with `--raise max_review_rounds`. Under a pause or a drain nothing more happens: the lead's
   *Recorded answer* hands back a `hand-back` answer at the reinstate; a later repair run acts on any other without
   asking again.
5. *The live-queue race.* The lead's *Recorded answer* can hand the task back after step 3, and its automatic retry
   never re-enters an answered block. `hand-back --answer <stamp>` is a compare-and-swap on the stamp and the form:
   if it exits 1, the lead or another session got there first (the answer is spent), or the task re-blocked since.
   That is no error: report it as handed back by the lead (it counts as the task's hand-back, § 4's Leash), and a new
   block is asked afresh. Repair never hands back a re-block on the old answer, and the verb never writes a tie.

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
   `<repoPath>/.claude/integration/race-<slug>.rc` (`0` green; any other rc red, `124` a timeout; `noslot`
   never ran (no verify slot came in time); absent: it never finished, which reads as red) with the tail of
   `race-<slug>.log` beside it. An UNVERIFIED task was never re-verified: say so.

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
neither the feedback nor the brief, or a second block after an automatic descope), and the verb recorded the refusal
on the task note, so its `humanFix` reads `decide scope or defer` in every session from now on and no later descope
of the block overrides it. While `descope_armed:` stands (a descope whose hand-back never ran) it records nothing
and its `ASK:` line ends `not recorded`: re-run the armed descope (its part and mode from the `## Scope decision
(automatic)` entry; exit 0, `[no-change]`), then hand back, as § 2's **plan-blocked, descopable** says. Exit 1 → report its ERROR line and leave the task set aside (an answered block among
them: § 3b's *Answer already recorded* acts first). In this session § 3d's judgement is the session's for
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

**3f — a completion verify halt → diagnose, then the hand-off (execute § 4.5 step 5, ADR 0052).** Every task
merged and the ceremony stopped at its completion verify: the last ROLLOUT-STATUS reason starts `completion verify`,
or status's `Completion verify:` line reads undecided with no lead live. Read it first, read-only:
`python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py completion-verify --rollout <rollout-note>`.
Never stamp the note done, skip the suite or write a `## Completion verify log` line by hand: the ceremony waits on
the suite, and only `--run` records a run. There is nothing to discard: a dead run leaves a free lock and no line, a
run whose verify refused (its words in the kept log the line names) records `unrun`, which counts toward the halt,
and the next `--run` clears its tree and files itself.
- `in-flight` → the lead's own `--run`: report it and wait, as for a RACE re-verify in flight.
- `completion verify: no verdict in three runs` → read the kept logs (`<out>.<run id>.log`, the lines name them)
  and `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/verify-slot.py status`: wedged verify slots, a saturated
  Mac or a broken `env_bootstrap`. A broken bootstrap or a wedged slot whose holder is gone is the note's or the
  machine's to fix: escalate with that evidence (§ 3c's form), never edit the command. Then § 4's hand-off: the next
  entry runs the attempt again.
- `completion verify failed` → its ERROR line says which: `origin unread` (the remote, its URL or its auth), a git dir it cannot read, refused rollout settings (`rollouts.toml`), a file it could not write (the tasks dir, the integration dir), no fcntl (`--run` is POSIX only: run the lead on a Mac or Linux machine), or a SHA-256 repository (`--detach-at` is 40-hex engine-wide: the completion verify cannot run there, so escalate whether to remove `completion_verifier:` from the note). Fix what is the machine's, escalate the rest, then § 4's hand-off.
- `completion verify: rollout note unreadable` → the `completion_verifier:`, `env_bootstrap:` or
  `completion_timeout:` value is Lachy's to fix: escalate with the ERROR line, never guess the command.
- A git-env trip at the completion verify (`git-env trip: …`, `git-env canary failed`) is § 3e's.
Log each in the rollout's `## Notes` as a dated `repair:` line, which § 6 copies.

### 4. Hand back: re-enter at the stage it stopped

Repair hands back only on Lachy's answer (§ 3b), this run's or one recorded for the task's current block (§ 3b's
*Answer already recorded*), and after § 3d's descope; the verb spends the task's answers itself (§ 3b's *Spent on the
hand-back*). Every route uses execute's own re-entry verb (`--answer <stamp>` on a recorded answer), and never under a
pause (§ 1):

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
- **The raise, on Lachy's word**, never silently: the field `humanFix.raise` names (`max_review_rounds`,
  `max_plan_rounds` or `max_iterations`: the budget the source run spent), or `max_review_rounds` for a revise
  re-entry (review-blocked, its last log line `rejected`) with no round left. Offer it with the task's § 3b ask. On
  his word it goes in through `record-answer --raise <field>`, never a hand-written frontmatter edit, and the verb
  refuses any other field. For a revise re-entry whose resolved `max_review_rounds` (task → rollout → rollouts.toml /
  built-in, execute § 3) is ≤ `lastRound`, it writes `max_review_rounds: <lastRound + 1>`. Any other raise is on an own
  call, which starts its plan, review and verifier budgets afresh, so a raise there writes the resolved value + 1: one
  more per call. Announce it in the report; the verb records it in a dated `## Notes` line
  (`- <YYYY-MM-DD> repair: [[<slug>]] <field> raised to <N>, one round`, `one iteration` for `max_iterations`) before
  the entry, then hand back. Execute's automatic retry already raises one round per retry that re-enters a revise with
  no round left, with this `## Notes` wording (ADR 0033 decision 7), so a further raise is only on Lachy's word.
  When the field is absent at both levels and `rollout-settings.py --repo <Project root>` exits 2 or 3,
  make no raise: report its stderr line (the verb's exit 1 carries it) and ask Lachy for the fix it names. A line naming
  `~/.config/thread/rollouts.toml` is fixed at that line, or by a stamp of the field on the task or
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
  Then, on Lachy's confirmation, by its state: OPEN → `record-answer --pr <url> --form hand-back`, then hand back
  with `--answer`; CLOSED → the restore above, then `record-answer --pr <url> --form hand-back` after `gh pr reopen`
  and before `hand-back --answer`, so the note never names a CLOSED PR (under a pause, where nothing is pushed or
  reopened, `--form awaiting-repair` with no `--pr`); MERGED → § 3c's possible PR-less merge (its `pr:` write, then
  `resume`). The OPEN and CLOSED `pr:` write runs
  wherever `hand-back` may (§ 1), a live queue included: no live call owns a set-aside note, so no reconcile
  overwrites it, and it goes with the hand-back that follows it. Once its answer reads, the live lead's *Recorded answer* may hand the task
  back first: `hand-back --answer` then exits 1, which is no error (§ 3b's live-queue race). With no PR for its branch, the options are recut, defer or leave.
- **Recut, only on Lachy's explicit ask:** a fresh start from the queue's current base.
  1. Run the landing-register check (execute § 2.5).
  2. Retire the branch with § 5's retire block plus `git -C <repoPath> branch -D <inputs.branch>`.
  3. Relabel it to its own run: the same pipe as above with `--kind own`.
  4. Run `hand-back`. Its old `## Integration log` lines survive and are harmless.
- **Leash:** repair re-enters a task on its own judgement only through § 3d's descope, once per task per repair
  run; every other hand-back follows Lachy's answer (§ 3b). `hand-back` starts a fresh automatic-retry stretch (the
  counters cleared, `auto_retry_sha` stamped), so the lead's retry has its budget again, and with the answer spent by
  the verb (§ 3b) an identical re-block comes straight back to him. A task that blocks again in this run is surfaced
  with its new diagnosis and three offers: *more guidance and one more hand-back*, *defer it* (§ 5), or *leave it
  set aside*. Don't loop.
- **Hand-off, when no lead is live and no pause stands**, and never while a RACE / UNVERIFIED escalation is
  undecided (§ 3c; report the hold and stop there), a git-env hold stands (§ 3e; report it and stop there) or
  the ladder file is refused (§ 2; name the file and stop there), and never on a rollout whose ceremony already ran
  (§ 3a's complete-rollout stop: report the repair and stop there): execute's queue loop, entered at its §4.5 resume
  (*Cold resume*). First the launch-directory check, execute § 2.8's snippet (point at it; never copy it here):
  `self-rollout-check.sh --launch-check <Project root> <launch dir>`, the launch directory being this session's
  primary working directory as the harness reports it, never `pwd`. A lead's tools reset every `cd` outside it, so
  a repair launched in the vault or in the in-place checkout would run a clone-rooted rollout's merges, verifies
  and worktrees from the wrong tree. Exit 0 goes on (pass a `WARN:` on); exit 3, exit 2 or any other non-zero exit
  stops repair at the diagnosis, with no hand-off: print its stderr verbatim and tell Lachy to start a session in
  the Project root and run `/thread:execute [[<rollout>]]` there. Then execute § 2.5 (then § 2.6), then execute
  § 3's `verify_timeout` check (a halt there
  writes nothing), then the canary's `check-all` (execute § 4.5 *Git-env canary*; a non-zero exit halts), then
  `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/step-boundary.py end --rollout <rollout-note>` (execute
  § Room stop: every loop entry ends a room stop, here one an ended owner session left, lapsed or not; with none standing
  it writes nothing, and a non-zero exit is printed and the hand-off goes on), then
  `reconcile-rollout.py resume`, then the loop with
  `--running ""` (this session holds no task call, so a room-stopped call's handle is lost: execute § Room stop
  item 10). Execute's § 2.7 pushed-base gate (entry points only)
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
stage), decisions injected (task + value), § 3b's answers (task + kind + ask + answer, read from each task's
`## Repair input` `(block …)` entries, spent and superseded ones included), gates signed, raises (task + new budget), automatic
descopes (task + part + follow-up or owner) from the `descope:` lines, whoever wrote them (§ 3d or the live lead),
merged-never-marked tasks flipped by `resume` (task + PR), tasks deferred (task + reason + dependants moved with it), a CLOSED PR or
missing branch (task + restore, recut, defer or leave), and the escalations of § 3c with Lachy's decisions:
possible PR-less merges, RACE / UNVERIFIED (task + PR + the re-verify verdict + the recorded decision), and
merges into another base (task + PR + base), and each git-env trip (§ 3e: the trip lines, the evidence's sha,
the choice, any restore and its rescue line, and the ack line).

### 7. A serial chain

A `shape: serial` note (§ 1) is a chain of **Legs** (`skills/execute/legs.md`), and repair is its conductor, never a
Leg: a Leg works the chain's tasks, while repair answers what only Lachy can, clears what he says, and starts the next
Leg as a new Session. Every step re-reads `leg.py status` (status § 5's read), whose header defines each key below.

**(a) Diagnose.** Show status § 5's report: the headline, the Legs, the Queue, Needs you, the Stall and the Restart.
The Stops are § 1's, already passed. Then (b) for every set-aside row, whatever the chain state, and then the first of
(c), (d) and (e) that applies.

**(b) Set-asides, in any state.** For each row with `setAside`:

- **A gate** (`setAside.status` gate-pending): present each of its `setAside.gates` verbatim. On his sign-off,
  `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py approve-gates --tasks <t> --rollout <rollout-note>`:
  the next Leg's claim re-enters it. If he declines it, Defer (below).
- **A block** (blocked, review-blocked or plan-blocked): `AskUserQuestion` quoting `setAside.summary`, offering hand
  back (with his guidance), defer, or leave it set aside.
  - Hand back: `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py record-answer --tasks <t> --rollout <rollout-note> --kind decision --ask "<the ask, verbatim>" --answer "<his answer, verbatim>" --fingerprint <row.setAside.fingerprint> --form hand-back`,
    then `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py hand-back --tasks <t> --answer <the stamp record-answer printed>`.
    The task reads claimable, and the next Leg's claim re-enters it with his answer as its latest `## Repair input`
    (`skills/execute/legs.md` § The task loop).
  - Leave: it stays set aside, and nothing more is asked this run.
- **Defer, dependency-aware** (§ 5's steps 1 and 3): read the row's `dependants` from `leg.py status`: its
  depends-on and blocked-by closure, transitive, through `merged_into:` tombstones, read the way next holds a
  dependency.
  - None → `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py defer --tasks <t> --rollout <rollout-note>`.
  - Some → ask: *"[[B]], [[C]] depend on [[A]]: defer the whole chain, or keep and fix [[A]]?"* Defer the chain →
    one `reconcile-rollout.py defer --tasks <t>,<each dependant> --rollout <rollout-note>`. Keep and fix → the hand
    back above.
  - A dependant a Leg holds (its `state` running, with an `owner`) → ask, and never write it or defer A alone.

A serial defer has no retire block (a serial task has no PR, task tree or anchor), deletes no Queue row or File-sets
line, and writes no note of its own: leg.py reads each deferred row as deferred, skipped and not counted (status
§ 5's footer, live or archived).

**(c) A halt** (`chain` halted). Show the halted Leg's `closed: halted:` line, the held task's latest `## Blocker
diagnosis` (if it has one), and `git -C <top> status --porcelain` for each `leg_base` top of that task. Ask. Only on his word:
`python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/leg.py clear-halt --rollout <rollout-note> --reason "<his words>"`, then
re-read `leg.py status`: the chain reads stalled when the halted Leg held a claim (the next Leg inherits it), else what
its rows leave (ready, completable or stuck), and (e) restarts it.

**(d) An open Leg** (`restart.takeOver` true: Leg K, the `openLeg`, is open, and `<id>` is the `session` of its
`legs` entry), whatever `restart.blockedBy` names first: a standing restart outranks an open Leg there, so a chain
`restarting` over an open Leg still needs this check. Check the Chorus Stage with `list_sessions`:

- the session is present → "Leg K is live in session `<id>`": report it, and stop;
- it is gone from `list_sessions`, or Lachy says Leg K is dead → (e), with the take-over;
- it cannot be resolved (no Stage, an id the Stage does not show) → ask Lachy.

**(e) Restart.** The next Leg starts as a new Session, never in this one.

1. **Restartable?** Re-read `leg.py status`. `restart` null → report why (a stuck chain goes back to (b)), and stop.
   Otherwise, by `restart.blockedBy`:
   - `halt` → never: (c) first.
   - `open Leg K (session <id>)` → only after (d) found `<id>` gone from `list_sessions`, or Lachy said Leg K is dead;
     the prompt is then the take-over form (`restart.takeOver`).
   - `handover started <X>` → only after `list_sessions` shows X gone, or Lachy says X never ran.
   - `restart Leg N (<how>)` → only with `--replace` in step 2, after its own check: for `started` (its id is
     `restarted.started`), `list_sessions` shows that id gone; for `pending` or `manual`, Lachy says it never started.
     With `restart.takeOver`, (d)'s evidence for Leg K too, and the prompt is the take-over form.
   - null → by `chain`: stalled; awaiting-successor with no hand-over line, or a manual one Lachy says he has not
     pasted; stopped, on his word; completable, not-started or ready, on his ask.
   - Anything else → report it, and stop.

   Whenever `restart.takeOver` is true, whatever the blocker, the restart needs (d)'s evidence: Leg K's session gone
   from `list_sessions`, or Lachy's word that Leg K is dead. A previous repair's check never stands in for it.

   `leg.py restarted` checks only the halt, the numbering (Leg N not begun, N = last_n + 1) and a standing restart.
   It never checks the open Leg or the hand-over, so that evidence is this step's. Nothing later re-checks a
   take-over: the new Leg's `begin --take-over` closes Leg K `lost`. `begin`'s lock and exit 3 back up only a doubled
   start.
2. **Mark it.** `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/leg.py restarted --rollout <rollout-note> --leg <restart.leg> --pending`,
   with `--replace` only on the `restart Leg N` branch. Exit 3 → report the standing restart, and stop.
   `recorded: false` → by `began`: `true`, Leg N began meanwhile: stop; `false`, this session's own identical line
   already stands (a re-run of this step, after a compaction say): go on to step 3. Exit 1 naming `--session` → this
   session has no id: report it, and stop; never invent one.
3. **Start it** with the host's `create_thread`, chosen as § Native runtime binding says (a claude harness, or
   `restart.anyLaunch`, on the Chorus Stage): `title`, `prompt`, `tldr` and `cwd` from `restart`, no `brief`,
   `report_back` on. Then `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/leg.py restarted --rollout <rollout-note> --leg <N> --started <its id>`.
4. **Otherwise** (no host tool, a codex launch off Codex Desktop, or a `create_thread` error): print `restart.prompt`
   fenced with its launch line (`restart.launch`, or any launch from `restart.cwd` when `restart.anyLaunch`), labelled
   `manual handoff`, then
   `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/leg.py restarted --rollout <rollout-note> --leg <N> --manual "<why>"`.

§ 7 writes no `## Notes` line by hand: the Leg log (through leg.py) and each task note's own records are the chain's
record, and its Completion log is the last Leg's.

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
  when its `humanFix` names another cause that is his, and for gates, escalations, a CLOSED PR, a missing branch or
  a missing `pr:`, a defer chain or a refused descope.
- **Don't hand back an answered question with its `## Needs you` still in place.** `record-answer --kind needs-you`
  removes the section in the answer's own save (§ 3b): neither `hand-back` nor a lead-written row clears it, so the
  verdict would read the answered question as open and never retry the task.
- **Don't write an answer, a raise or a spend by hand.** `record-answer` is the only writer of a `## Repair input`
  answer (it supersedes an earlier one and carries the raise and the `pr:`, the entry last), and `hand-back` spends it;
  never edit a key, and never hand back on an answer but through `hand-back --answer <stamp>`.
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
- **Don't hand a finished rollout back to execute.** A rollout whose note reads `status: done` or sits in
  `Archive/Rollouts/` had its ceremony: flip what `resume` finds, record it, and stop (§ 3a's complete-rollout stop).
  A hand-off would re-run the completion ceremony on it.
- **Don't reinstate a rollout another rollout's `supersedes:` names.** Its unlanded tasks were carried there;
  finish its close-out instead (§ 1).
- **Don't defer a task with dependants alone.** Compute the closure first; defer the chain or fix it. On a serial
  chain the closure is `leg.py status`'s `dependants` (§ 7 (b)).
- **Don't run a serial chain's Legs.** § 7 runs only `leg.py status`, `leg.py restarted`, `leg.py clear-halt` (his
  word only), `approve-gates`, `record-answer`, `hand-back` and `defer` (with its dependants), and the Chorus Stage's
  `list_sessions` and `create_thread`. Never `leg.py begin`, `claim`, `done`, `close`, `set-aside`, `smoke`,
  `file-fix`, `handed` or `file-followup`; no Workflow, `next`, `resume` or hand-off loop; no hand edit of the Leg log
  or the frontmatter, and no `## Notes` line; and never take over a session `list_sessions` shows present, without
  his word.
- **Don't loop.** One hand-back per task per run (§ 4's Leash); then surface and let the user decide.
- **Don't run repair under the built-in `/loop` (and never suggest it).** Repair is input-gated by design: it
  asks the user decisions no agent can make, so an unattended loop would either hang on the question or
  steamroll it. Unattended driving belongs to execute (§8: the Stop-hook driver + heartbeat cron) and status
  (read-only sweeps); repair stays a hands-on verb.
