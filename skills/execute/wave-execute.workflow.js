export const meta = {
  name: 'wave-execute',
  description: 'Run a wave-schedule rollout: per-task plan-gate → Ralph verify → master review, converging in parallel within each wave',
  phases: [
    { title: 'Plan-gate' },
    { title: 'Implement' },
    { title: 'Review' },
  ],
}

// =============================================================================
// wave-execute convergence engine (protocol_version: 3)
//
// Invoked by the wave-execute skill via Workflow({ scriptPath, args }). The skill
// owns vault I/O, the protocol gate, config resolution, status reconciliation,
// reporting, the --gated between-wave pause, and the soft-pause check (a
// `pause_requested: true` flag on the rollout note, honoured by reconcile-wave.py's
// end-of-wave cursor step — the engine never sees a pause because continuous mode
// passes it ONE wave per call, and the skill simply doesn't launch the next one).
// This script owns ONLY the three-layer convergence engine.
//
// args = {
//   rolloutSlug : string,            // e.g. "giflab-rollout"
//   repoPath    : string,            // absolute path to the project repo
//   verifier    : string,            // shell command that decides pass/fail in a worktree
//   date        : string,            // YYYY-MM-DD (passed in; Date.now() is unavailable here)
//   concurrency : number,            // per-wave parallel ceiling (memory safety; default 4)
//   knownBaselineFailures : string[],// optional; "test_id — reason" lines for tests already red on a
//                                    //   clean main. Threaded into every agent so they don't re-diagnose
//                                    //   them. Absent/empty ⇒ prompts render byte-identical to pre-item-2.
//   envBootstrap : string,           // optional; shell command run ONCE per worktree right after the agent
//                                    //   cd's in (env-bootstrap), e.g. "poetry env use 3.11 && poetry install".
//                                    //   Absent/empty ⇒ worktree setup renders byte-identical to pre-feature.
//   waves       : [{
//     wave  : number,
//     tasks : [{
//       slug            : string,    // task note basename, e.g. "giflab-fix-coalesce"
//       taskPath        : string,    // absolute path to the task note
//       scope           : "single-file" | "cross-cutting" | "read-only",
//       planGate        : boolean,   // resolved by the skill from plan_approval + scope
//       maxIterations   : number,    // Ralph verifier-retry budget
//       maxReviewRounds : number,    // master-review budget
//       maxPlanRounds   : number,    // plan-gate budget
//       ignoreGate      : boolean,   // optional; true ⇒ inject an operator override of any human/release
//                                    //   gate in the note (per-task-override-channel). Absent/false ⇒ byte-identical.
//       model           : "opus" | "fable",
//                                    // optional; resolved by the skill (task → rollout → "opus").
//                                    //   The task's STARTING tier. An opus task gets a ONE-SHOT first
//                                    //   pass at each layer (one plan, one implementation + one verifier
//                                    //   run, one review round); the first rejection/red/block ESCALATES
//                                    //   the task to fable for all remaining work — sticky, judges follow.
//                                    //   A fable task runs its whole pipeline on fable, as before.
//       effort          : string,    // optional; per-task ESCAPE HATCH (ADR 0004), resolved by the skill
//                                    //   from the task note's `effort:` frontmatter. Overrides the tier
//                                    //   bundle's planner/implementer effort for THIS task only — judges
//                                    //   always keep the EFFORT matrix. low | medium | high | xhigh | max.
//                                    //   Absent ⇒ the tier bundle decides (opus: medium, fable: high).
//     }]
//   }]
// }
//
// Returns { rolloutSlug, tasks: [{ slug, scope, status, prUrl, branch, worktreePath,
//   reviewRoundsUsed, planRoundsUsed, blockerDiagnosis, reviewFeedback, summary,
//   model, escalated, escalatedAt }] }
// where status ∈ review | review-blocked | blocked | plan-blocked, model is the FINAL tier the task
// ran on, and escalated/escalatedAt ('plan' | 'implement' | 'review') record an opus→fable escalation.
// =============================================================================

// ---- Structured schemas (replace the old sentinel strings) ------------------

const PLAN_VERDICT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ready: { type: 'boolean', description: 'true when a complete plan was produced' },
    blocked: { type: 'boolean', description: 'true if the task is malformed / unrecoverable' },
    blockerCause: { type: 'string', description: 'one-line cause when blocked, else empty string' },
    plan: { type: 'string', description: 'full structured plan text (Files to modify, Test strategy, Sibling-site check, Caller-wiring, Edge cases, Risks). Empty string if blocked.' },
  },
  required: ['ready', 'blocked', 'blockerCause', 'plan'],
}

const PLAN_JUDGE = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['approve', 'changes'] },
    feedback: { type: 'array', items: { type: 'string' }, description: '3–8 specific bullets when verdict is changes; empty when approve' },
  },
  required: ['verdict', 'feedback'],
}

const IMPL_RESULT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verified: { type: 'boolean', description: 'true if the verifier reached the accepted green state (exit 0, or — when a baseline manifest is present — only known-baseline tests fail, each matching its listed reason) before the PR was opened' },
    blocked: { type: 'boolean', description: 'true if Ralph exhausted max iterations or the worktree was unsafe' },
    escalate: { type: 'boolean', description: 'true ONLY when your instructions gave you a ONE-SHOT verifier run and it was red — the task hands over to the stronger tier. Always false when you ran the full verification loop or did no implementation.' },
    prUrl: { type: 'string', description: 'PR URL, or empty string when blocked / read-only' },
    branch: { type: 'string', description: 'branch name, or empty string' },
    worktreePath: { type: 'string', description: 'absolute worktree path from git rev-parse --show-toplevel' },
    blockerDiagnosis: { type: 'string', description: 'one-paragraph diagnosis when blocked, else empty string' },
    summary: { type: 'string', description: 'one-paragraph summary of what changed and was tested' },
  },
  required: ['verified', 'blocked', 'escalate', 'prUrl', 'branch', 'worktreePath', 'blockerDiagnosis', 'summary'],
}

const REVIEW_VERDICT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['approve', 'changes'] },
    feedback: { type: 'array', items: { type: 'string' }, description: '3–8 specific bullets when verdict is changes; empty when approve' },
  },
  required: ['verdict', 'feedback'],
}

// ---- Shared prompt fragments ------------------------------------------------

// The bug classes reviewers caught in the giflab rollout — every code-writing
// agent gets these as explicit preflight checks before opening/updating a PR.
const BUG_PREFLIGHTS = `
Before you open or update a PR, run these preflight checks:
- Dead code: if you add a new function/helper, verify it has at least one PRODUCTION caller, not just tests.
- No-op assertions: if you write a bounded assertion, check whether upstream code already clamps to the same bounds — if so your assertion tests nothing.
- Sibling-site blindness: after a fix, grep the whole file AND codebase for the same code shape; fix every sibling occurrence in this PR (or justify leaving them).
- Worktree safety: run \`git rev-parse --show-toplevel\` and confirm it is NOT the project's main checkout. Run \`git diff --stat\` and confirm every modified path is in your task's scope — if you see unrelated files, STOP and report instead of committing.
- Worktree path discipline: your worktree root is the absolute path \`git rev-parse --show-toplevel\` prints — call it $WT. Every Read/Edit/Write MUST target a path UNDER $WT (e.g. \`$WT/src/foo.py\`). Edit requires an absolute path — do NOT absolutize against the project root you were handed (that is the MAIN checkout): an edit to a \`<project-root>/…\` path lands in the main checkout, OUTSIDE your branch and invisible to your PR — which looks exactly like a "silent Edit no-op" but is really a wrong-tree edit. After editing, \`git -C $WT diff\` MUST show your change; if it does not, you edited the wrong tree — redo it against the \`$WT/…\` path.`.trim()

// Re-dispatch awareness. A resumed blocked task carries the prior attempt's diagnosis in its note —
// reconcile-wave.py appends `## Review-blocked feedback` / `## Blocker diagnosis` / `## Plan-blocked
// feedback`, and /wave:repair may inject a `## Repair input` with a human decision. Without an explicit
// nudge the agent can re-read the note and silently repeat the rejected work. This line is static (always
// in the prompt) and harmless on a fresh task where no such section exists.
const PRIOR_FEEDBACK_NOTE = `If the task note has a "## Review-blocked feedback", "## Blocker diagnosis", "## Plan-blocked feedback", or "## Repair input" section from a PRIOR attempt, treat it as AUTHORITATIVE — resolve every point in it first, and use any "## Repair input" value exactly as given (do not re-derive or second-guess it).`

// Known-baseline-failures manifest (item 2). When the rollout declares tests that already fail on a clean
// `main` for environmental reasons, every agent gets this so N agents don't each independently re-diagnose
// the same reds. Returns "" when empty so the surrounding prompt is BYTE-IDENTICAL to pre-item-2 behaviour
// (the resume-cache invariant) — the non-empty string carries its OWN leading "\n\n", so callers
// interpolate it bare (`${BUG_PREFLIGHTS}${baselineManifest(a)}`) with no surrounding whitespace.
function baselineManifest(a) {
  const reds = a.knownBaselineFailures
  if (!reds || !reds.length) return ''
  return `

This repo has KNOWN BASELINE FAILURES — tests that already fail on a clean \`main\` for pre-existing,
environmental reasons. They are NOT in your scope:
${reds.map((b) => '- ' + b).join('\n')}
Do NOT try to fix them, do NOT flag them as findings, and do NOT \`--deselect\`/skip them (that would hide a
real regression). Keep running the full verifier; only a NEW failure — or a baseline test failing in a way
that does not match its listed reason — is yours to act on.`
}

// Per-task human/release gate override (per-task-override-channel). Some task notes carry a prose gate
// ("don't action until a release ships", "hold for sign-off"); without a structured override an agent may
// refuse mid-dispatch. When the skill resolves ignore_gate for a task, the engine tells the agent that gate
// is deliberately overridden for THIS run. Empty when unset ⇒ prompts render BYTE-IDENTICAL to pre-feature
// behaviour (resume-cache invariant); the non-empty string carries its OWN leading "\n\n" so callers
// interpolate it bare (`…${baselineManifest(a)}${gateOverride(task)}`).
function gateOverride(task) {
  if (!task.ignoreGate) return ''
  return `

OPERATOR OVERRIDE: this task note may carry a human/release gate (e.g. "do not action until a release ships",
"hold for sign-off"). For THIS run that gate is EXPLICITLY OVERRIDDEN by the operator — do not refuse or pause
on account of it; proceed with the task as specified.`
}

// baseline (item 2): array of "test_id — reason" lines, or empty/undefined. When empty the returned text is
// BYTE-IDENTICAL to the pre-item-2 template (resume-cache invariant — do NOT edit the empty branch below).
function ralphLoop(verifier, maxIterations, baseline) {
  if (baseline && baseline.length) {
    return `
Verification loop (Ralph-style):
- Verifier: ${verifier}
- Max iterations: ${maxIterations}
- KNOWN BASELINE FAILURES (pre-existing, environmental — NOT yours; keep running the full verifier, do NOT
  \`--deselect\`/skip them — that hides real regressions):
${baseline.map((b) => '  - ' + b).join('\n')}
- For i = 1 .. ${maxIterations}:
  a. Run the verifier.
  b. GREEN CRITERION (baseline-aware): the work is verified when EVERY failing test is in the known-baseline
     set above (fewer is fine — a baseline red going green is GOOD, never a failure; a baseline entry absent
     from this run is simply ignored). Treat that state as "pass" and stop the loop.
  c. On a REAL failure — a test OUTSIDE the baseline set fails, OR a baseline test fails in a way that does
     NOT match its listed reason (when unsure whether it matches, treat it as a NEW failure: fail-closed) —
     read the output, diagnose the ROOT cause (not the surface symptom), apply a targeted fix, and commit it
     on the branch (so history records each attempt).
  d. If i == ${maxIterations} and a REAL (non-baseline) failure still remains: do NOT open/update a PR.
     Return a result with blocked=true, verified=false, and a one-paragraph blockerDiagnosis of what you
     tried and why it did not converge. Also append that diagnosis to the task note under a "## Blocker diagnosis" heading.`.trim()
  }
  return `
Verification loop (Ralph-style):
- Verifier: ${verifier}
- Max iterations: ${maxIterations}
- For i = 1 .. ${maxIterations}:
  a. Run the verifier.
  b. If it passes (exit 0): stop the loop, the work is verified.
  c. On failure: read the output, diagnose the ROOT cause (not the surface symptom),
     apply a targeted fix, and commit it on the branch (so history records each attempt).
  d. If i == ${maxIterations} and it still fails: do NOT open/update a PR. Return a result with
     blocked=true, verified=false, and a one-paragraph blockerDiagnosis of what you tried and why
     it did not converge. Also append that diagnosis to the task note under a "## Blocker diagnosis" heading.`.trim()
}

// The opus first pass does NOT iterate — one verifier run, then either green or hand-over. Iteration is
// evidence of hardness, and iteration runs at fable (see Model tiering below). baseline: same
// "test_id — reason" array as ralphLoop; the green criterion stays baseline-aware.
function oneShotVerify(verifier, baseline) {
  const green = baseline && baseline.length ? `
- KNOWN BASELINE FAILURES (pre-existing, environmental — NOT yours; keep running the full verifier, do NOT
  \`--deselect\`/skip them — that hides real regressions):
${baseline.map((b) => '  - ' + b).join('\n')}
- GREEN CRITERION (baseline-aware): the work is verified when EVERY failing test is in the known-baseline
  set above (fewer is fine — a baseline red going green is GOOD, never a failure; a baseline entry absent
  from this run is simply ignored).` : `
- GREEN CRITERION: the verifier exits 0 — the work is verified.`
  return `
Verification (ONE-SHOT first pass — you do NOT iterate):
- Verifier: ${verifier}
- Run the verifier EXACTLY ONCE.${green}
- If green: the work is verified — proceed.
- If red (any failure outside the green criterion): do NOT attempt a fix, do NOT run the verifier again,
  and do NOT open/update a PR. Commit your work so far on the branch (so the next tier inherits it),
  append a one-paragraph diagnosis of the failure to the task note under a "## Blocker diagnosis"
  heading, and return escalate=true, verified=false, blocked=false with the same diagnosis in
  blockerDiagnosis. A stronger model picks up your worktree and iterates from there.`.trim()
}

// Tier-selected verification block for code-writing prompts: the opus first pass gets the one-shot,
// fable (seeded or escalated) gets the full Ralph loop.
function verifyBlock(tier, verifier, maxIterations, baseline) {
  return tier === 'opus' ? oneShotVerify(verifier, baseline) : ralphLoop(verifier, maxIterations, baseline)
}

// Escalation hand-over context (empty-when-unused, like baselineManifest/gateOverride — the non-empty
// string carries its OWN leading "\n\n" so callers interpolate it bare). `prior` is the first-pass
// attempt's diagnosis/feedback verbatim.
function escalationContext(prior) {
  if (!prior) return ''
  return `

ESCALATION: you are the STRONGER-TIER takeover of this task — a first-pass attempt at a lower tier did
not land it, and you own it from here. The prior attempt's diagnosis (verbatim):
${prior}
Any committed work from that attempt is already on your branch — build on or replace it as the diagnosis
warrants; do not blindly repeat the failed approach.`
}

// ---- Prompt builders (5 variants, inlined; this file cannot read .md at runtime) ----

function implementerPrompt(task, a, tier, prior) {
  return `You're picking up [[${task.slug}]] from the rollout at [[${a.rolloutSlug}]].

Task note: ${task.taskPath}
Project root: ${a.repoPath}

${worktreeSetup(a, task)}

Steps:
1. Read the task note in full + every source file it references. Do not skim. ${PRIOR_FEEDBACK_NOTE}
2. If the fix is well-defined, work test-first (write the failing test before the fix). Use the
   superpowers:test-driven-development skill if applicable.
3. If the task is investigation-first, produce findings, propose a fix in the task note, then implement.
4. ${verifyBlock(tier, task.verifier || a.verifier, task.maxIterations, a.knownBaselineFailures)}
5. If the verifier passed: open a PR titled \`audit-fix: <task subject>\`. The body must link the task
   note and explain what changed and why.
6. Return your structured result: verified, blocked, escalate (as your verification block instructs;
   false otherwise), prUrl, branch, worktreePath (from \`git rev-parse --show-toplevel\`),
   blockerDiagnosis (empty if not blocked), and a one-paragraph summary.

${BUG_PREFLIGHTS}${baselineManifest(a)}${gateOverride(task)}${escalationContext(prior)}

Do not update the task's \`status:\` yourself — the lead session reconciles that after review.`
}

function readOnlyPrompt(task, a, prior) {
  return `You're picking up [[${task.slug}]] from the rollout at [[${a.rolloutSlug}]]. This is a
READ-ONLY task (scope: read-only) — investigation / audit, NO source edits, NO PR.

Task note: ${task.taskPath}
Project root: ${a.repoPath}

Investigate READ-ONLY directly against the project repo at ${a.repoPath} — do NOT create a worktree,
do NOT modify any source files.

Steps:
1. Read the task note in full + every file it references.
2. Run the read-only investigation it asks for (greps, baseline verifier run to OBSERVE, reading tests).
3. Append your findings to the task note under a "## Findings" heading — concrete, with file:line refs.
4. Return your structured result: verified=true (findings produced) or blocked=true (could not complete),
   escalate=false, prUrl="", branch="", worktreePath="" (read-only tasks open no worktree),
   blockerDiagnosis (empty unless blocked), and a one-paragraph summary of what you found.${baselineManifest(a)}${escalationContext(prior)}`
}

function plannerPrompt(task, a, prior) {
  return `You're picking up [[${task.slug}]] from the rollout at [[${a.rolloutSlug}]].

This task is GATED ON PLAN APPROVAL. In this dispatch you produce a structured plan ONLY — DO NOT write
any code, DO NOT open a PR, DO NOT modify source files. A judge will review your plan and either approve it
(you'll be re-dispatched to implement) or send it back for revision.

Task note: ${task.taskPath}
Project root: ${a.repoPath}

Investigate READ-ONLY directly against the project repo at ${a.repoPath} (no worktree, no source edits) —
you are producing a plan only; the implementer opens the worktree later.

Steps:
1. Read the task note in full + every source file it references. Do not skim. ${PRIOR_FEEDBACK_NOTE}
2. Read-only investigation to back the plan:
   - grep for sibling sites of the same anti-pattern across the file + codebase
   - identify callers of any function you intend to change/add
   - run the verifier ONCE to capture the baseline (\`${a.verifier}\`) — observe only, write no fix code
   - skim related tests
3. Produce a plan with EXACTLY these sub-sections, concrete not abstract:
   ### Files to modify  (repo-relative path: one-line rationale)
   ### Test strategy    (test-first? which failing test first? which existing tests assert this?)
   ### Sibling-site check (the anti-pattern; verbatim greps run + counts; all sibling occurrences in scope)
   ### Caller-wiring     (what calls the new/changed surface; grep proof; are tests the only callers?)
   ### Edge cases        (explicit list)
   ### Risks / unknowns  (what could go wrong; what you want the reviewer to weigh in on)
4. Return your structured result: ready=true with the full plan text in \`plan\`, blocked=false, blockerCause="".

If during investigation you find the task is fundamentally malformed (impossible, contradicts a committed
change, etc.), append a one-paragraph diagnosis to the task note under "## Blocker diagnosis" and return
ready=false, blocked=true, blockerCause="<one line>", plan="".${baselineManifest(a)}${gateOverride(task)}${escalationContext(prior)}`
}

function planJudgePrompt(task, planText, a) {
  return `You are reviewing an implementation PLAN (no code written yet) for [[${task.slug}]] from the
rollout [[${a.rolloutSlug}]]. Apply rigorous judgement — your job is to catch a weak plan before any code
is written.

Task note (the brief to judge against): ${task.taskPath}
Project root: ${a.repoPath}

The plan to review:
---
${planText}
---

Check, against the task brief:
- Does the plan actually address the brief?
- Are the listed files reasonable and complete?
- Sibling-site check done properly (greps run, all occurrences accounted for)?
- Caller-wiring check done (dead-code prevention — is the new surface actually called in production)?
- Are the edge cases the right ones?
- Are the stated risks/unknowns the real ones?

Read the brief and grep the repo as needed to verify the plan's claims — do not approve on faith.
Decide: verdict "approve" if the plan is sound (clean or trivially nitpicky), else "changes" with 3–8
specific, actionable feedback bullets.`
}

function planReviserPrompt(task, priorPlan, priorFeedback, round, a) {
  const grouped = priorFeedback
    .map((r) => `Round ${r.round} rejection:\n${r.feedback.map((f) => '- ' + f).join('\n')}`)
    .join('\n\n')
  return `PLAN REVISION ROUND ${round}: a reviewer requested changes to your prior plan for [[${task.slug}]]
(rollout [[${a.rolloutSlug}]]). Still plan-only — NO code, NO PR, NO source edits.

Task note: ${task.taskPath}
Project root: ${a.repoPath}

Your prior plan:
---
${priorPlan}
---

Feedback to address — ACCUMULATED across every prior review round. Every bullet still applies unless your
revision demonstrably resolves it; do not drop an earlier round's concern to satisfy a later one:
${grouped}

Run additional READ-ONLY investigation as needed. Rewrite the plan with the SAME required sub-sections
(Files to modify / Test strategy / Sibling-site check / Caller-wiring / Edge cases / Risks). Return
ready=true with the rewritten plan in \`plan\`. If you discover the task is unrecoverable, return
ready=false, blocked=true, blockerCause="<one line>".`
}

function approvedPlanImplementerPrompt(task, planText, a, tier, prior) {
  return `PLAN APPROVED for [[${task.slug}]] (rollout [[${a.rolloutSlug}]]). Implement the approved plan below.

Task note: ${task.taskPath}
Project root: ${a.repoPath}

${worktreeSetup(a, task)}

The approved plan:
---
${planText}
---

Implement the plan as written. Do NOT re-plan or substantially deviate. Minor refinements within the
plan's spirit (a slightly different test name, a one-line helper not listed) are fine — the bar is "would
the reviewer recognise this as the approved plan?". If you discover during implementation that the plan is
wrong (an assumption breaks, a named file doesn't exist as described), STOP and return blocked=true with
blockerDiagnosis="plan-divergence: <one line>" instead of forging ahead.

Steps:
1. Implement the plan (test-first where the plan says so). ${PRIOR_FEEDBACK_NOTE}
2. ${verifyBlock(tier, task.verifier || a.verifier, task.maxIterations, a.knownBaselineFailures)}
3. On verifier pass: open a PR titled \`audit-fix: <task subject>\`, body links the task note + explains the change.
4. Return your structured result: verified, blocked, escalate (as your verification block instructs; false
   otherwise), prUrl, branch, worktreePath (git rev-parse --show-toplevel), blockerDiagnosis, summary.

${BUG_PREFLIGHTS}${baselineManifest(a)}${gateOverride(task)}${escalationContext(prior)}

Do not update the task's \`status:\` yourself — the lead session reconciles that after review.`
}

function reviewJudgePrompt(task, prevImpl, a) {
  const depth = task.scope === 'cross-cutting'
    ? `This is a CROSS-CUTTING change — review it structurally and rigorously. Apply the discipline of the
superpowers:requesting-code-review skill: correctness, brief adherence, missed sibling sites, dead code,
no-op assertions, edge cases, test quality. Approve ONLY if findings are clean or trivially nitpicky.`
    : `This is a SINGLE-FILE change — review it for correctness, adherence to the brief, sloppiness, and
edge cases.`
  return `You are reviewing an OPEN PR for [[${task.slug}]] from the rollout [[${a.rolloutSlug}]].

PR: ${prevImpl.prUrl}
Task note (the brief): ${task.taskPath}
Project root: ${a.repoPath}

${depth}

Read \`gh pr diff ${prevImpl.prUrl}\` and the task brief. Decide: verdict "approve" if the PR is sound, else
"changes" with 3–8 specific, actionable feedback bullets (these become the reviser's instructions).${baselineManifest(a)}`
}

function reviserPrompt(task, prevImpl, feedback, round, a) {
  return `REVISION ROUND ${round}: master review requested changes on your prior pass for [[${task.slug}]]
(rollout [[${a.rolloutSlug}]]).

You are working in an EXISTING worktree on an EXISTING branch with an OPEN PR — NOT a fresh one.
Worktree path: ${prevImpl.worktreePath}
Branch: ${prevImpl.branch}
PR: ${prevImpl.prUrl}

First action: \`cd ${prevImpl.worktreePath}\` and confirm via \`git rev-parse --show-toplevel\` that you are
in that worktree (NOT the project's main checkout) and on branch ${prevImpl.branch}.

Review feedback to address (verbatim):
${feedback.map((f) => '- ' + f).join('\n')}

Apply every feedback bullet. Push new commits to the existing branch (the PR auto-updates) — do NOT open a
new PR.

${ralphLoop(task.verifier || a.verifier, task.maxIterations, a.knownBaselineFailures)}

${BUG_PREFLIGHTS}${baselineManifest(a)}

Do not update the task's \`status:\` yourself — the lead session reconciles that after review.

Return your structured result: verified, blocked, escalate=false (you run the full verification loop),
prUrl (unchanged), branch (unchanged), worktreePath, blockerDiagnosis, summary.`
}

// ---- Helpers ----------------------------------------------------------------

function shortAlias(slug) {
  // drop a leading "<project>-" segment for the branch name, mirroring the prose skill
  const i = slug.indexOf('-')
  return i === -1 ? slug : slug.slice(i + 1)
}

// Worktrees are created EXPLICITLY under the TARGET repo, not via isolation:'worktree'.
// Rationale: the harness's isolation:'worktree' worktrees the *session's* git root (proven
// empirically — from an ops/vault session it grabs ~/repos/workspaces, the wrong repo, and
// ignores repoPath). Anchoring the worktree on a.repoPath makes the engine correct from ANY
// launch location and places worktrees under <repoPath>/.claude/worktrees/ (where the daily
// reaper finds them). Cleanup is the reaper's job, not the harness's.
function worktreeDir(repoPath, slug) {
  return `${repoPath}/.claude/worktrees/${slug}`
}

// Optional per-rollout env bootstrap (env-bootstrap): a command run once, right after the agent enters its
// worktree, so every agent starts from a working interpreter + deps instead of each independently
// rediscovering an env fix (e.g. `poetry env use 3.11 && poetry install`). Empty/unset ⇒ returns '' so
// worktreeSetup renders BYTE-IDENTICAL to pre-feature behaviour (resume-cache invariant), exactly like
// baselineManifest / gateOverride. It runs in every arm (fresh OR reused worktree) — it's idempotent env
// setup, not a git op, so it does not touch the "reuse arms must not re-fetch/rebase" invariant below.
function envBootstrapStep(a) {
  if (!a.envBootstrap) return ''
  return `
  ${a.envBootstrap}   # one-time env bootstrap from the rollout (env_bootstrap): establish interpreter + deps`
}

// Bash the code-writing agents run as their FIRST action to enter an isolated worktree of the
// target repo. Resume-safe: reuse the dir if it exists, attach an existing branch, else create.
function worktreeSetup(a, task) {
  const wt = worktreeDir(a.repoPath, task.slug)
  const br = `audit-fix/${shortAlias(task.slug)}`
  return `First, set up your ISOLATED worktree of the TARGET repo (NOT the session repo). Run exactly:
  WT="${wt}"; BR="${br}"
  if [ -d "$WT" ]; then cd "$WT";
  elif git -C "${a.repoPath}" show-ref --verify --quiet "refs/heads/$BR"; then git -C "${a.repoPath}" worktree add "$WT" "$BR" && cd "$WT";
  else git -C "${a.repoPath}" fetch origin --quiet && git -C "${a.repoPath}" worktree add "$WT" -b "$BR" origin/main && cd "$WT"; fi
  git rev-parse --show-toplevel   # MUST print "$WT" (your worktree), NOT ${a.repoPath} (the main checkout) — STOP if it doesn't${envBootstrapStep(a)}
Work only inside this worktree: every git / edit / verifier / PR command runs from here. ALL file-tool
paths (Read/Edit/Write) must be under "$WT" — e.g. "$WT/src/foo.py". NEVER edit a "${a.repoPath}/…" path:
that is the MAIN checkout, and an edit there lands outside your branch, invisible to your PR — the failure
that looks like a "silent Edit no-op" but is really a wrong-tree edit. After any edit, confirm \`git -C "$WT" diff\` shows it.
A FRESH worktree is branched from a freshly-fetched origin/main (NOT local HEAD) so it includes every
prior wave that has already merged. The two reuse arms above are unchanged — they must NOT re-fetch or
rebase an in-flight branch on resume.`
}

function chunk(arr, n) {
  const out = []
  const size = Math.max(1, n || 1)
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// ---- Model tiering -----------------------------------------------------------
// task.model seeds the task's STARTING tier (task → rollout → 'opus'; wave:schedule pre-stamps
// structural/deep tasks 'fable' — the predictive step-up). At run time the tier is per-task MUTABLE
// state: an opus task gets a one-shot first pass at each layer, and the first evidence of hardness
// anywhere — plan-judge 'changes', a first-pass planner/investigator block, a red one-shot verifier
// run, an implementer block, or a review-judge 'changes' — ESCALATES the task to fable for all
// remaining work. Escalation is one-way and sticky; judges follow the live tier (a.judgeModel, when
// set, still pins all judges). A fable-seeded task never escalates — there is nothing above fable —
// and runs the full Ralph loop from the start, exactly as before. The skill stamps `model: fable`
// on the note at reconcile when a task escalated, so later re-dispatches start at fable.
function taskModel(task) { return task.model || 'opus' }
function judgeFor(a, st) { return (a && a.judgeModel) || st.tier }
function escalate(st, slug, at) {
  st.tier = 'fable'
  st.escalated = true
  if (!st.escalatedAt) st.escalatedAt = at
  log(`escalation: ${slug} → fable (${at})`)
}

// ---- Effort bundles (ADR 0004) ----------------------------------------------
// A tier is a (model, per-role EFFORT) bundle, not two knobs. This matrix is the ONE place the
// per-role efforts live — fixed in the engine, deliberately not rollout config (tuning it means
// editing this file: the matrix encodes a stance about where effort is worth paying, not a
// per-rollout preference — see ADR 0004's rejected options). Escalation flips st.tier, and every
// spawn site reads this matrix at dispatch time, so a mid-task opus→fable flip carries effort
// automatically: no second ladder, no extra stamp.
//   implementer  — the plan/code-writing role: planner, plan-reviser, implementer, reviser,
//                  read-only investigator
//   judge        — the plan-gate judge
//   masterReview — the PR-review judge (the master-side review layer)
//   reconcile    — mechanical reconcile stages. Documented stance only today: reconcile is
//                  deterministic Python (scripts/reconcile-wave.py), so no agent() consumes this
//                  row — it fixes the effort for any future mechanical agent stage.
const EFFORT = {
  opus:  { implementer: 'medium', judge: 'high', masterReview: 'high',  reconcile: 'low' },
  fable: { implementer: 'high',   judge: 'high', masterReview: 'xhigh', reconcile: 'low' },
}

// Effort for the planner/implementer role at the task's LIVE tier. Per-task `effort:` frontmatter
// (task.effort) is the SINGLE escape hatch (ADR 0004): it overrides the bundle's planner/implementer
// effort for that task only — judges always keep the matrix — and it is absolute across an
// escalation (a monster task at fable/max stays at max).
function implEffort(st, task) {
  return (task && task.effort) || EFFORT[st.tier].implementer
}

// Effort for a judge role ('judge' | 'masterReview'). Judges take the bundle of the tier they RUN
// on — judgeFor() — so a judgeModel pin moves model and effort together (a tier is a bundle). The
// fallback guards a judgeModel value with no matrix row (fail to the task's tier, never crash).
function judgeEffort(a, st, role) {
  return (EFFORT[judgeFor(a, st)] || EFFORT[st.tier])[role]
}

// ---- Dispatch resilience: transient agent death -----------------------------
// A terminal API/connection error (observed 2026-07-18: "API Error: Connection closed mid-response") kills
// the agent process mid-run, and the Workflow `agent()` global surfaces that as a `null` return. Left
// unguarded that null propagates into a later stage and throws (e.g. `null is not an object (evaluating
// 'prevImpl.prUrl')` when a dead implementer's null reaches reviewLoop), and the task is reported with the
// useless generic "workflow stage threw" diagnosis. runAgent() centralises the guard: it does ONE automatic
// in-run retry (connection deaths are near-always transient — the manual re-dispatch recovered first-try in
// every observed case), and if the agent is STILL dead it returns a distinguished `{ __dead: true }`
// sentinel instead of a raw null. Every layer below checks `.__dead` immediately after the call and converts
// it into a CLEAN transient block, so no stage ever dereferences a null and the cause is CLASSIFIED —
// reconcile then writes an actionable "re-dispatch cleanly" note instead of the generic stage-threw string.
const TRANSIENT_DIAGNOSIS =
  'transient infrastructure failure — the agent process died mid-run on a terminal API/connection error ' +
  '(e.g. "Connection closed mid-response"), NOT a task-authored blocker. Re-dispatch cleanly: the worktree ' +
  'and any committed work are reusable and a fresh dispatch of the same prompt should proceed normally.'

async function runAgent(prompt, opts) {
  let r = await agent(prompt, opts)
  if (r == null) {
    log(`agent death (null return) on ${(opts && opts.label) || '?'} — one automatic retry`)
    r = await agent(prompt, opts)
  }
  return r == null ? { __dead: true } : r
}

// Layer-appropriate clean blocks for a dead agent (see runAgent). The specific diagnosis is what makes the
// transient case cheap: reconcile writes "re-dispatch cleanly" and the lead auto-retries instead of
// hand-diagnosing an infra blip from the <failures> block.
function transientPlanBlock(task, rounds) {
  return { task, blocked: true, status: 'plan-blocked', blockerDiagnosis: TRANSIENT_DIAGNOSIS, planRoundsUsed: rounds }
}
function transientImplBlock(extra) {
  return { blocked: true, blockerDiagnosis: TRANSIENT_DIAGNOSIS, ...(extra || {}) }
}

// ---- The three convergence layers -------------------------------------------

async function planLoop(task, st, a) {
  let plan = await runAgent(plannerPrompt(task, a, ''), {
    label: `plan:${task.slug}`, phase: 'Plan-gate', schema: PLAN_VERDICT, model: st.tier, effort: implEffort(st, task),
  })
  if (plan.__dead) return transientPlanBlock(task, 0)
  if ((plan.blocked || !plan.ready) && st.tier === 'opus') {
    // A first-pass planner failure is evidence of hardness — one fable retry before plan-blocked.
    escalate(st, task.slug, 'plan')
    plan = await runAgent(plannerPrompt(task, a, plan.blockerCause || 'first-pass planner produced no plan'), {
      label: `plan:${task.slug}@fable`, phase: 'Plan-gate', schema: PLAN_VERDICT, model: st.tier, effort: implEffort(st, task),
    })
    if (plan.__dead) return transientPlanBlock(task, 0)
  }
  if (plan.blocked || !plan.ready) {
    return { task, blocked: true, status: 'plan-blocked', blockerDiagnosis: plan.blockerCause || 'planner returned no plan', planRoundsUsed: 0 }
  }
  // Accumulate every round's rejection rationale (item 1): thread the FULL judge feedback into each
  // revise round and into the plan-blocked diagnosis, mirroring what a manual re-dispatch achieves by
  // letting a fresh planner read the rationale appended to the task note.
  const priorFeedback = []
  let round = 1
  while (round <= task.maxPlanRounds) {
    const verdict = await runAgent(planJudgePrompt(task, plan.plan, a), {
      label: `plan-judge:${task.slug} r${round}`, phase: 'Plan-gate', schema: PLAN_JUDGE, model: judgeFor(a, st), effort: judgeEffort(a, st, 'judge'),
    })
    if (verdict.__dead) return transientPlanBlock(task, round)
    if (verdict.verdict === 'approve') {
      return { task, blocked: false, plan: plan.plan, planRoundsUsed: round }
    }
    // Record this round's rejection BEFORE the max-rounds return and the reviser dispatch, so both the
    // plan-blocked diagnosis and the next reviser see the complete accumulated rationale (push with the
    // judge round `round`, not `round + 1` — that off-by-one would mislabel the "Round N" headings).
    priorFeedback.push({ round, feedback: verdict.feedback })
    if (round === task.maxPlanRounds) {
      return {
        task, blocked: true, status: 'plan-blocked', planRoundsUsed: round,
        blockerDiagnosis: 'plan not approved after ' + round + ' rounds. Accumulated reviewer feedback:\n' +
          priorFeedback.map((r) => 'Round ' + r.round + ': ' + r.feedback.join('; ')).join('\n'),
      }
    }
    // Opus got its one judged round; revision is iteration, and iteration runs at fable.
    if (st.tier === 'opus') escalate(st, task.slug, 'plan')
    plan = await runAgent(planReviserPrompt(task, plan.plan, priorFeedback, round + 1, a), {
      label: `plan-revise:${task.slug} r${round + 1}`, phase: 'Plan-gate', schema: PLAN_VERDICT, model: st.tier, effort: implEffort(st, task),
    })
    if (plan.__dead) return transientPlanBlock(task, round + 1)
    if (plan.blocked || !plan.ready) {
      return { task, blocked: true, status: 'plan-blocked', blockerDiagnosis: plan.blockerCause || 'plan-reviser returned no plan', planRoundsUsed: round + 1 }
    }
    round += 1
  }
}

async function implement(task, st, prev, a) {
  if (prev && prev.blocked) return prev // plan-blocked passthrough
  // Plan-stage metadata to thread forward (or carry onto a transient block) when a plan was approved.
  const planExtra = (task.planGate && prev && prev.plan) ? { planRoundsUsed: prev.planRoundsUsed || 0 } : undefined
  if (task.scope === 'read-only') {
    let r = await runAgent(readOnlyPrompt(task, a, ''), {
      label: `investigate:${task.slug}`, phase: 'Implement', schema: IMPL_RESULT, model: st.tier, effort: implEffort(st, task),
    })
    if (r.__dead) return transientImplBlock()
    if (r.blocked && st.tier === 'opus') {
      escalate(st, task.slug, 'implement')
      r = await runAgent(readOnlyPrompt(task, a, r.blockerDiagnosis || 'first-pass investigation did not complete'), {
        label: `investigate:${task.slug}@fable`, phase: 'Implement', schema: IMPL_RESULT, model: st.tier, effort: implEffort(st, task),
      })
      if (r.__dead) return transientImplBlock()
    }
    return r
  }
  // Same builder for both passes: st.tier is read at build time, so the opus call renders the
  // one-shot verification block and the post-escalation call renders the full Ralph loop.
  const prompt = (prior) => (task.planGate && prev && prev.plan)
    ? approvedPlanImplementerPrompt(task, prev.plan, a, st.tier, prior)
    : implementerPrompt(task, a, st.tier, prior)
  let r = await runAgent(prompt(''), {
    label: `implement:${task.slug}`, phase: 'Implement', schema: IMPL_RESULT, model: st.tier, effort: implEffort(st, task),
  })
  // A dead agent is transient infra, NOT evidence of hardness — do NOT escalate; report a clean block.
  if (r.__dead) return transientImplBlock(planExtra)
  if ((r.escalate || r.blocked) && st.tier === 'opus') {
    // One-shot red or a first-pass block: the task has proven non-mechanical. Fable takes over in the
    // same worktree (the committed attempt + note diagnosis carry over; an approved plan is NOT
    // re-planned) with the full Ralph budget.
    escalate(st, task.slug, 'implement')
    const prior = [r.blockerDiagnosis, r.summary].filter((s) => s && s.trim()).join('\n')
      || 'first-pass attempt did not verify green'
    r = await runAgent(prompt(prior), {
      label: `implement:${task.slug}@fable`, phase: 'Implement', schema: IMPL_RESULT, model: st.tier, effort: implEffort(st, task),
    })
    if (r.__dead) return transientImplBlock(planExtra)
  }
  // Defensive: a result that neither verified nor blocked and has no PR cannot go to review.
  if (!r.verified && !r.blocked && !r.prUrl) {
    r = { ...r, blocked: true, blockerDiagnosis: r.blockerDiagnosis || 'agent returned neither verified nor blocked' }
  }
  // thread the plan-stage metadata forward so the final report shows plan_rounds_used
  return planExtra ? { ...r, ...planExtra } : r
}

async function reviewLoop(task, st, prev, a) {
  // plan-blocked passthrough (no IMPL_RESULT shape)
  if (prev && prev.blocked && prev.status === 'plan-blocked') return prev
  // Ralph-blocked OR transient-dead implement result (both carry blocked=true)
  if (prev && prev.blocked) return { ...prev, status: 'blocked' }
  if (task.scope === 'read-only') return { ...prev, status: 'review', reviewRoundsUsed: 0 }

  let current = prev
  let round = 1
  while (round <= task.maxReviewRounds) {
    const verdict = await runAgent(reviewJudgePrompt(task, current, a), {
      label: `review:${task.slug} r${round}`, phase: 'Review', schema: REVIEW_VERDICT, model: judgeFor(a, st), effort: judgeEffort(a, st, 'masterReview'),
    })
    // Dead review-judge: the PR is real and stands — block on transient infra so the lead re-judges it.
    if (verdict.__dead) return { ...current, status: 'blocked', blockerDiagnosis: TRANSIENT_DIAGNOSIS }
    if (verdict.verdict === 'approve') {
      return { ...current, status: 'review', reviewRoundsUsed: round }
    }
    if (round === task.maxReviewRounds) {
      return { ...current, status: 'review-blocked', reviewRoundsUsed: round, reviewFeedback: verdict.feedback }
    }
    // Opus got its one judged PR round; revision is iteration, and iteration runs at fable.
    if (st.tier === 'opus') escalate(st, task.slug, 'review')
    const revised = await runAgent(reviserPrompt(task, current, verdict.feedback, round + 1, a), {
      label: `revise:${task.slug} r${round + 1}`, phase: 'Review', schema: IMPL_RESULT, model: st.tier, effort: implEffort(st, task),
    })
    if (revised.__dead) return { ...current, status: 'blocked', blockerDiagnosis: TRANSIENT_DIAGNOSIS }
    if (revised.blocked) {
      return { ...current, status: 'blocked', blockerDiagnosis: revised.blockerDiagnosis }
    }
    current = { ...current, ...revised }
    round += 1
  }
}

// One task, end to end: plan-gate → implement → review, sharing a single mutable tier state so an
// escalation in any layer carries into every later agent AND judge. Tasks converge independently —
// the orchestration below runs converge() per item with no cross-task barrier inside a chunk.
async function converge(task, a) {
  const st = { tier: taskModel(task), escalated: false, escalatedAt: '' }
  const planned = task.planGate ? await planLoop(task, st, a) : { task, plan: null, blocked: false }
  const impl = await implement(task, st, planned, a)
  const reviewed = await reviewLoop(task, st, impl, a)
  return reviewed ? { ...reviewed, model: st.tier, escalated: st.escalated, escalatedAt: st.escalatedAt } : reviewed
}

// ---- Orchestration: waves are barriers, tasks within a wave pipeline ---------

// The Workflow tool passes `args` to a scriptPath workflow JSON-stringified, not as a live
// object (confirmed empirically: the script sees `typeof args === 'string'`). Parse defensively
// so the engine works whether args arrives as a string or an object.
const a = typeof args === 'string' ? JSON.parse(args) : args
const ceiling = a.concurrency || 4
const allResults = []

log(`wave-execute: ${a.rolloutSlug} — ${a.waves.length} wave(s), parallel ceiling ${ceiling}/wave`)

for (const wave of a.waves) {
  log(`Wave ${wave.wave}: ${wave.tasks.length} task(s)`)
  // Memory-safety: chunk heavy waves so no more than `ceiling` worktrees run at once.
  // Within a chunk, converge() runs per task with no barrier — task A can be in Review while
  // task B is still Implementing, exactly as the old three-stage pipeline allowed.
  for (const group of chunk(wave.tasks, ceiling)) {
    const out = await pipeline(group, (t) => converge(t, a))
    out.forEach((r, i) => {
      const t = group[i]
      const norm = r || { blocked: true, status: 'blocked', blockerDiagnosis: 'workflow stage threw — see /workflows' }
      allResults.push({
        slug: t.slug,
        scope: t.scope,
        status: norm.status || (norm.blocked ? 'blocked' : 'review'),
        prUrl: norm.prUrl || '',
        branch: norm.branch || '',
        worktreePath: norm.worktreePath || '',
        reviewRoundsUsed: norm.reviewRoundsUsed || 0,
        planRoundsUsed: norm.planRoundsUsed || 0,
        blockerDiagnosis: norm.blockerDiagnosis || '',
        reviewFeedback: norm.reviewFeedback || [],
        summary: norm.summary || '',
        model: norm.model || taskModel(t),
        escalated: !!norm.escalated,
        escalatedAt: norm.escalatedAt || '',
      })
    })
  }
  const blockedThisWave = allResults.filter((r) => r.status === 'blocked' || r.status === 'plan-blocked' || r.status === 'review-blocked')
  log(`Wave ${wave.wave} done — ${allResults.filter((r) => r.status === 'review').length} clean, ${blockedThisWave.length} blocked so far`)
}

return { rolloutSlug: a.rolloutSlug, tasks: allResults }
