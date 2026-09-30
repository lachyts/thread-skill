# Spike: one session holds several Workflow calls in flight

Date: 2026-09-30 · Task: `thread-skill-p12-1-spike-concurrent-workflow-calls` · For: ADR 0030 decision 4

## Question

The queue (ADR 0030) has execute's lead session hold the parallel ceiling's worth of Workflow calls
at once, one per task, plus an integration call in a task's worktree. Can one session do that?

## Method

Claude Code CLI, Opus 5.5 session launched in this repo. Three trivial Workflow scripts, each one
`effort: 'low'` agent running a single Bash command: `date +%s`, a `python3` sleep of N seconds, then
`date +%s`. A (60 s) and B (180 s) were launched in the same turn. B also ran `git -C <worktree>`
against a throwaway detached worktree (`.claude/worktrees/spike-p12-1`, from `origin/master`) passed
in `args`. C (30 s) was launched in a later turn while A and B were in flight.

## Result

| Call | Run ID | Start (epoch) | End (epoch) | Held |
|---|---|---|---|---|
| A | `wf_449f3845-d80` | 1790736321 | 1790736381 | 60 s |
| B | `wf_ba8f75b9-4f8` | 1790736325 | 1790736505 | 180 s |
| C | `wf_c16d1d17-d63` | 1790736330 | 1790736360 | 30 s |

- **Calls overlap.** All three ran at once from 1790736330 to 1790736360; C ran wholly inside A's
  window. Order of completion: C, then A, then B.
- **Each completion arrives as its own notification**, in completion order, each carrying its own
  result and journal path.
- **A call can start while others are in flight** (C, launched with A and B running).
- **A call works in a worktree passed in `args`.** B's agent resolved `head 1cf694f` and the
  worktree as its toplevel.
- Nothing was blocked: Bash and a long `python3` sleep ran inside workflow agents.

## Limits and caveats

- Only three concurrent calls were tested. The per-call agent cap is `min(16, CPUs - 2)` (Workflow
  reference); a cross-call cap, if any, was not reached. The default parallel ceiling is 4, plus one
  integration call: test five at the first live run (p12-13).
- C was launched while A and B ran, but not in reaction to a completion notification, so "start
  the next task on a notification" was not exercised literally. It is the same launch mechanism.
- Each trivial call cost about 36k subagent tokens (one agent, two tool uses): the per-call floor.

## Verdict

ADR 0030 decision 4 holds: the lead session can run the queue as concurrent per-task Workflow calls
plus a separate integration call in the task's worktree. P12 proceeds as designed.
