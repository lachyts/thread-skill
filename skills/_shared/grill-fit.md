# The grill-fit check — route every fork before a prompt leaves

Run it while composing a prompt another session will execute cold: today orient § 8's batch prompts
and handoff § Build the handoff prompt. It is a checklist step inside composition, not a new phase.

1. **List the forks**, not the mechanics: scope choices, strategy trade-offs, "which approach"
   moments, anything matching grill-me's trigger signals (vague intent, an unscoped feature decision).
2. **Decide each fork.** (a) **Resolvable** by the executing session from code or data: say so in
   the prompt ("decide X from Y"). (b) **A genuine Lachy decision**: bake a gate line into the
   prompt. The fork returns to Lachy via grill-me: the session reports the fork and its evidence,
   never resolves it downstream and never spawns a task for it.
3. **No forks → no grill language at all.** Don't manufacture ceremony.

**Example.** The Smart Slider silent-stall diagnosis needed this gate, and got it only by hand:

> Gates: NO optimizer edits — diagnosis only. The remediation decision that follows your findings
> (ceiling vs deadline fix vs UX copy vs park for Patrick) returns to Lachy for a grill-me session —
> do NOT spawn a remediation fix task directly; report the fork and its evidence instead.

**How a fork comes back.**

- **Orient batch:** the child stops that task at the fork, leaves it open and ends it with
  `partial: fork for Lachy: <fork>; evidence: <…>` (orient § 8 End-of-run updates). The lead lists
  it in the batch's close-out line as a decision for Lachy, so does `--debrief` (orient § 10), and
  orient § 7 keeps the task out of batches until he decides.
- **Handoff:** the consumer is interactive, so it stops at the fork and asks.

**What it is not.** Not the conversation-gated exclusion (orient § 7), which keeps out a task that
needs Lachy *before* it starts; this check routes forks that surface *mid-work*. Not ADR 0008's gated
inputs (spend, credentials, irreversible actions in rollouts), which the engine enforces separately.
