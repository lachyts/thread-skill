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
// reporting, and the --gated between-wave pause. This script owns ONLY the
// three-layer convergence engine.
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
//                                    //   Applies to planner/implementer/reviser/investigator. Judges
//                                    //   (plan-judge, review-judge) default to "opus" (overridable via judgeModel arg).
//     }]
//   }]
// }
//
// Returns { rolloutSlug, tasks: [{ slug, scope, status, prUrl, branch, worktreePath,
//   reviewRoundsUsed, planRoundsUsed, blockerDiagnosis, reviewFeedback, summary }] }
// where status ∈ review | review-blocked | blocked | plan-blocked.
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
    prUrl: { type: 'string', description: 'PR URL, or empty string when blocked / read-only' },
    branch: { type: 'string', description: 'branch name, or empty string' },
    worktreePath: { type: 'string', description: 'absolute worktree path from git rev-parse --show-toplevel' },
    blockerDiagnosis: { type: 'string', description: 'one-paragraph diagnosis when blocked, else empty string' },
    summary: { type: 'string', description: 'one-paragraph summary of what changed and was tested' },
  },
  required: ['verified', 'blocked', 'prUrl', 'branch', 'worktreePath', 'blockerDiagnosis', 'summary'],
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

// ---- Prompt builders (5 variants, inlined; this file cannot read .md at runtime) ----

function implementerPrompt(task, a) {
  return `You're picking up [[${task.slug}]] from the rollout at [[${a.rolloutSlug}]].

Task note: ${task.taskPath}
Project root: ${a.repoPath}

${worktreeSetup(a, task)}

Steps:
1. Read the task note in full + every source file it references. Do not skim. ${PRIOR_FEEDBACK_NOTE}
2. If the fix is well-defined, work test-first (write the failing test before the fix). Use the
   superpowers:test-driven-development skill if applicable.
3. If the task is investigation-first, produce findings, propose a fix in the task note, then implement.
4. ${ralphLoop(task.verifier || a.verifier, task.maxIterations, a.knownBaselineFailures)}
5. If the verifier passed: open a PR titled \`audit-fix: <task subject>\`. The body must link the task
   note and explain what changed and why.
6. Return your structured result: verified, blocked, prUrl, branch, worktreePath (from
   \`git rev-parse --show-toplevel\`), blockerDiagnosis (empty if not blocked), and a one-paragraph summary.

${BUG_PREFLIGHTS}${baselineManifest(a)}${gateOverride(task)}

Do not update the task's \`status:\` yourself — the lead session reconciles that after review.`
}

function readOnlyPrompt(task, a) {
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
   prUrl="", branch="", worktreePath="" (read-only tasks open no worktree), blockerDiagnosis (empty unless
   blocked), and a one-paragraph summary of what you found.${baselineManifest(a)}`
}

function plannerPrompt(task, a) {
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
ready=false, blocked=true, blockerCause="<one line>", plan="".${baselineManifest(a)}${gateOverride(task)}`
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

function approvedPlanImplementerPrompt(task, planText, a) {
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
2. ${ralphLoop(task.verifier || a.verifier, task.maxIterations, a.knownBaselineFailures)}
3. On verifier pass: open a PR titled \`audit-fix: <task subject>\`, body links the task note + explains the change.
4. Return your structured result: verified, blocked, prUrl, branch, worktreePath (git rev-parse --show-toplevel),
   blockerDiagnosis, summary.

${BUG_PREFLIGHTS}${baselineManifest(a)}${gateOverride(task)}

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

Return your structured result: verified, blocked, prUrl (unchanged), branch (unchanged), worktreePath,
blockerDiagnosis, summary.`
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
// Opus 4.8 is the default for every agent; wave:schedule may step a genuinely hard
// task (cross-cutting / deep-reasoning) up to fable via task frontmatter. The two
// judge roles gatekeep merges; they default to opus — overridable per-run via the
// `judgeModel` arg (e.g. pin to fable for a genuinely hard rollout); falls back to opus when unset.
function judgeModel(a) { return (a && a.judgeModel) || 'opus' }
function taskModel(task) { return task.model || 'opus' }

// ---- The three convergence layers -------------------------------------------

async function planLoop(task, a) {
  let plan = await agent(plannerPrompt(task, a), {
    label: `plan:${task.slug}`, phase: 'Plan-gate', schema: PLAN_VERDICT, model: taskModel(task),
  })
  if (plan.blocked || !plan.ready) {
    return { task, blocked: true, status: 'plan-blocked', blockerDiagnosis: plan.blockerCause || 'planner returned no plan', planRoundsUsed: 0 }
  }
  // Accumulate every round's rejection rationale (item 1): thread the FULL judge feedback into each
  // revise round and into the plan-blocked diagnosis, mirroring what a manual re-dispatch achieves by
  // letting a fresh planner read the rationale appended to the task note.
  const priorFeedback = []
  let round = 1
  while (round <= task.maxPlanRounds) {
    const verdict = await agent(planJudgePrompt(task, plan.plan, a), {
      label: `plan-judge:${task.slug} r${round}`, phase: 'Plan-gate', schema: PLAN_JUDGE, model: judgeModel(a),
    })
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
    plan = await agent(planReviserPrompt(task, plan.plan, priorFeedback, round + 1, a), {
      label: `plan-revise:${task.slug} r${round + 1}`, phase: 'Plan-gate', schema: PLAN_VERDICT, model: taskModel(task),
    })
    if (plan.blocked || !plan.ready) {
      return { task, blocked: true, status: 'plan-blocked', blockerDiagnosis: plan.blockerCause || 'plan-reviser returned no plan', planRoundsUsed: round + 1 }
    }
    round += 1
  }
}

async function implement(task, prev, a) {
  if (prev && prev.blocked) return prev // plan-blocked passthrough
  if (task.scope === 'read-only') {
    return await agent(readOnlyPrompt(task, a), {
      label: `investigate:${task.slug}`, phase: 'Implement', schema: IMPL_RESULT, model: taskModel(task),
    })
  }
  if (task.planGate && prev && prev.plan) {
    const r = await agent(approvedPlanImplementerPrompt(task, prev.plan, a), {
      label: `implement:${task.slug}`, phase: 'Implement', schema: IMPL_RESULT, model: taskModel(task),
    })
    // thread the plan-stage metadata forward so the final report shows plan_rounds_used
    return r ? { ...r, planRoundsUsed: prev.planRoundsUsed || 0 } : r
  }
  return await agent(implementerPrompt(task, a), {
    label: `implement:${task.slug}`, phase: 'Implement', schema: IMPL_RESULT, model: taskModel(task),
  })
}

async function reviewLoop(task, prev, a) {
  // plan-blocked passthrough (no IMPL_RESULT shape)
  if (prev && prev.blocked && prev.status === 'plan-blocked') return prev
  // Ralph-blocked implement result
  if (prev && prev.blocked) return { ...prev, status: 'blocked' }
  if (task.scope === 'read-only') return { ...prev, status: 'review', reviewRoundsUsed: 0 }

  let current = prev
  let round = 1
  while (round <= task.maxReviewRounds) {
    const verdict = await agent(reviewJudgePrompt(task, current, a), {
      label: `review:${task.slug} r${round}`, phase: 'Review', schema: REVIEW_VERDICT, model: judgeModel(a),
    })
    if (verdict.verdict === 'approve') {
      return { ...current, status: 'review', reviewRoundsUsed: round }
    }
    if (round === task.maxReviewRounds) {
      return { ...current, status: 'review-blocked', reviewRoundsUsed: round, reviewFeedback: verdict.feedback }
    }
    const revised = await agent(reviserPrompt(task, current, verdict.feedback, round + 1, a), {
      label: `revise:${task.slug} r${round + 1}`, phase: 'Review', schema: IMPL_RESULT, model: taskModel(task),
    })
    if (revised.blocked) {
      return { ...current, status: 'blocked', blockerDiagnosis: revised.blockerDiagnosis }
    }
    current = { ...current, ...revised }
    round += 1
  }
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
  // Within a chunk, pipeline() lets task A reach Review while task B is still Implementing — no barrier.
  for (const group of chunk(wave.tasks, ceiling)) {
    const out = await pipeline(
      group,
      (t) => (t.planGate ? planLoop(t, a) : { task: t, plan: null, blocked: false }),
      (prev, t) => implement(t, prev, a),
      (prev, t) => reviewLoop(t, prev, a),
    )
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
      })
    })
  }
  const blockedThisWave = allResults.filter((r) => r.status === 'blocked' || r.status === 'plan-blocked' || r.status === 'review-blocked')
  log(`Wave ${wave.wave} done — ${allResults.filter((r) => r.status === 'review').length} clean, ${blockedThisWave.length} blocked so far`)
}

return { rolloutSlug: a.rolloutSlug, tasks: allResults }
