// Verifies the resume-cache invariant for the optional features in wave-execute.workflow.js:
//   - gateOverride(task)      → '' when ignoreGate is unset (byte-identical prompts), text when set
//   - envBootstrapStep(a)     → '' when envBootstrap is unset, a command line when set
//   - worktreeSetup(a, task)  → identical to its pre-feature output when envBootstrap is unset; when set,
//                               it equals the unset output PLUS exactly the injected bootstrap line.
//   - escalationContext(prior)→ '' when prior is empty, hand-over block when set; a prompt with prior
//                               equals the prior-less prompt PLUS exactly the injected block.
//   - verifyBlock(tier, …)    → opus renders the ONE-SHOT block (no iteration), fable the full Ralph loop.
//   - gated inputs (ADR 0008) → the plan prompt ALWAYS renders the Gated inputs requirement; a non-empty
//                               unapproved declaration pauses the task (status gate-pending) even when
//                               planGate is false; approved gates on the note are never re-asked; "None"
//                               leaves behaviour identical (zero-touch). Only list items declare gates —
//                               prose is commentary (ADR 0013); a section with no items and no "None"
//                               fails closed to plan-blocked, same as a missing section.
//   - review-loop memory      → reviewHistoryBlock/stepBackBlock '' when unused (round-1 judge prompt
//                               byte-identical); reviser gets latest round as work order + earlier rounds
//                               as anti-regression constraints; step-back (with the approved plan when
//                               gated) fires on the round-3+ reviser; both ceiling outcomes return the
//                               accumulated reviewHistory, and only a with-history final-round approval
//                               sets approvedAtCeiling.
// Evaluates only the pure-function region of the engine (before the orchestration that needs Workflow
// globals) in a vm sandbox. Run: node tests/prompt-invariants.test.mjs   (exit 0 = pass)
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(here, '..', 'wave-execute.workflow.js'), 'utf8')

const marker = '// ---- Orchestration'
const idx = src.indexOf(marker)
if (idx === -1) { console.error('FAIL - orchestration marker not found'); process.exit(1) }
let head = src.slice(0, idx).replace('export const meta', 'const meta')
head += '\nvar __t = { gateOverride, envBootstrapStep, worktreeSetup, escalationContext, verifyBlock, oneShotVerify, ralphLoop, implementerPrompt, plannerPrompt, planReviserPrompt, planJudgePrompt, approvedPlanImplementerPrompt, reviewJudgePrompt, reviserPrompt, groupedRounds, reviewHistoryBlock, stepBackBlock, parseGatedInputs, unapprovedGates, runAgent, planLoop, implement, reviewLoop, converge, EFFORT, implEffort, judgeEffort, tierCap, clampTier, taskModel, judgeFor, terminalTier, escalate, effortTier, readOnlyPrompt, normaliseTier };\n'

// `agent` and `log` are Workflow globals the engine expects at run time. The layer functions resolve them
// against the sandbox global at CALL time, so the transient-death tests below swap `ctx.agent` per case to
// script agent deaths (a null return) and observe that no stage throws.
const ctx = { console, log: () => {}, agent: async () => null }
vm.createContext(ctx)
vm.runInContext(head, ctx)
const T = ctx.__t

let fail = 0
const ok = (c, l) => { if (c) console.log('ok   - ' + l); else { console.log('FAIL - ' + l); fail = 1 } }

const task0 = { slug: 'proj-fix-x', ignoreGate: false }
const taskG = { slug: 'proj-fix-x', ignoreGate: true }
ok(T.gateOverride(task0) === '', 'gateOverride: empty when unset')
ok(T.gateOverride(taskG).includes('OPERATOR OVERRIDE'), 'gateOverride: present when set')

const a0 = { repoPath: '/repo' }
const aE = { repoPath: '/repo', envBootstrap: 'poetry env use 3.11 && poetry install' }
ok(T.envBootstrapStep(a0) === '', 'envBootstrapStep: empty when unset')
ok(T.envBootstrapStep(aE).includes('poetry install'), 'envBootstrapStep: present when set')

const wt0 = T.worktreeSetup(a0, task0)
const wtE = T.worktreeSetup(aE, task0)
ok(!wt0.includes('env_bootstrap'), 'worktreeSetup: byte-clean when env unset')
ok(wtE.includes('poetry install') && wtE.includes('env_bootstrap'), 'worktreeSetup: injects bootstrap when set')
ok(wtE.replace(T.envBootstrapStep(aE), '') === wt0, 'worktreeSetup: set == unset + exactly the injected line (byte-identical base)')

// ---- Model tiering: one-shot first pass + escalation hand-over ----------------

// State doubles: ST_OPUS an uncapped opus first pass, ST_FABLE an escalated/seeded fable task,
// ST_CAPPED an opus task under maxTier:'opus' whose escalation has been suppressed.
const ST_OPUS = { tier: 'opus', cap: 'fable', escalated: false, capSuppressed: false }
const ST_FABLE = { tier: 'fable', cap: 'fable', escalated: true, capSuppressed: false }
const ST_CAPPED = { tier: 'opus', cap: 'opus', escalated: false, capSuppressed: true }
ok(T.escalationContext('') === '', 'escalationContext: empty when unused (empty string)')
ok(T.escalationContext(undefined, ST_FABLE) === '', 'escalationContext: empty when unused (undefined)')
ok(T.escalationContext('diag', ST_FABLE).includes('ESCALATION'), 'escalationContext: hand-over block when set')

const vOpus = T.verifyBlock(ST_OPUS, 'make test', 3, undefined)
const vFable = T.verifyBlock(ST_FABLE, 'make test', 3, undefined)
ok(vOpus.includes('ONE-SHOT') && !vOpus.includes('Max iterations'), 'verifyBlock: opus = one-shot, no iteration budget')
ok(vOpus.includes('escalate=true'), 'verifyBlock: one-shot instructs the escalate signal on red')
ok(vFable.includes('Max iterations: 3') && !vFable.includes('ONE-SHOT'), 'verifyBlock: fable = full Ralph loop')
ok(vFable === T.ralphLoop('make test', 3, undefined), 'verifyBlock: fable arm is byte-identical to ralphLoop (resume-cache)')

const vOpusB = T.verifyBlock(ST_OPUS, 'make test', 3, ['test_x — env'])
ok(vOpusB.includes('KNOWN BASELINE FAILURES') && vOpusB.includes('test_x — env'), 'oneShotVerify: baseline arm renders the manifest')

const taskI = { slug: 'proj-fix-x', taskPath: '/vault/proj-fix-x.md', ignoreGate: false, maxIterations: 3 }
const aI = { repoPath: '/repo', rolloutSlug: 'proj-rollout', verifier: 'make test' }
const pOpus = T.implementerPrompt(taskI, aI, ST_OPUS, '')
const pFable = T.implementerPrompt(taskI, aI, ST_FABLE, '')
ok(pOpus.includes('ONE-SHOT') && !pOpus.includes('Max iterations'), 'implementerPrompt: opus tier renders the one-shot block')
ok(pFable.includes('Max iterations: 3') && !pFable.includes('ONE-SHOT'), 'implementerPrompt: fable tier renders the Ralph loop')
const prior = 'the verifier failed on test_y'
const pPrior = T.implementerPrompt(taskI, aI, ST_FABLE, prior)
ok(pPrior.includes('ESCALATION'), 'implementerPrompt: escalation context present when prior set')
ok(pPrior.replace(T.escalationContext(prior, ST_FABLE), '') === pFable, 'implementerPrompt: with prior == without + exactly the injected block (byte-identical base)')

// ---- Effort bundles (ADR 0007): a tier is a (model, per-role effort) bundle ----
// The matrix is fixed in the engine — opus: implementer medium / judges high / master review high;
// fable: implementer high / judges high / master review xhigh; reconcile low on either tier. Per-task
// `effort:` frontmatter is the SINGLE escape hatch: it overrides the planner/implementer effort only —
// judges always keep the matrix. Escalation flips st.tier, so effort carries automatically.

ok(T.EFFORT.opus.implementer === 'medium' && T.EFFORT.opus.judge === 'high'
  && T.EFFORT.opus.masterReview === 'high' && T.EFFORT.opus.reconcile === 'low',
  'EFFORT: opus bundle = implementer medium, judges high, master review high, reconcile low')
ok(T.EFFORT.fable.implementer === 'high' && T.EFFORT.fable.judge === 'high'
  && T.EFFORT.fable.masterReview === 'xhigh' && T.EFFORT.fable.reconcile === 'low',
  'EFFORT: fable bundle = implementer high, judges high, master review xhigh, reconcile low')

ok(T.implEffort({ tier: 'opus' }, {}) === 'medium', 'implEffort: opus tier → medium')
ok(T.implEffort({ tier: 'fable' }, {}) === 'high', 'implEffort: fable tier → high')
ok(T.implEffort({ tier: 'opus' }, { effort: 'max' }) === 'max', 'implEffort: per-task effort override wins at opus')
ok(T.implEffort({ tier: 'fable' }, { effort: 'max' }) === 'max', 'implEffort: per-task effort override wins at fable')
ok(T.judgeEffort(undefined, { tier: 'opus' }, 'judge') === 'high', 'judgeEffort: plan judge high at opus')
ok(T.judgeEffort(undefined, { tier: 'fable' }, 'judge') === 'high', 'judgeEffort: plan judge high at fable')
ok(T.judgeEffort(undefined, { tier: 'opus' }, 'masterReview') === 'high', 'judgeEffort: master review high at opus')
ok(T.judgeEffort(undefined, { tier: 'fable' }, 'masterReview') === 'xhigh', 'judgeEffort: master review xhigh at fable')
ok(T.judgeEffort({ judgeModel: 'fable' }, { tier: 'opus' }, 'masterReview') === 'xhigh',
  'judgeEffort: a judgeModel pin carries the pinned tier\'s effort (model + effort travel together)')

// No rollout-level effort config, deliberately (ADR 0007 rejected options): the rollout template must
// never grow an `effort:` key.
const tpl = fs.readFileSync(path.join(here, '..', '..', 'schedule', 'rollout-template.md'), 'utf8')
ok(!/\beffort\s*:/i.test(tpl), 'rollout template: no effort: key (no rollout-level effort config)')

// End-to-end: every spawn site passes the matrix effort for its role + the task's LIVE tier.
// ctx.agent records (label, model, effort) per dispatch; converge() drives all three layers.
const aEff = { repoPath: '/repo', rolloutSlug: 'proj-rollout', verifier: 'make test' }
const baseEff = { taskPath: '/v/t.md', maxIterations: 3, maxReviewRounds: 2, maxPlanRounds: 2 }
const effortCalls = []
function recordingAgent(impl) {
  return async (prompt, opts) => {
    effortCalls.push({ label: opts.label, model: opts.model, effort: opts.effort })
    return impl(prompt, opts)
  }
}
const greenImpl = { verified: true, blocked: false, escalate: false, prUrl: 'https://pr/9', branch: 'b', worktreePath: '/wt', blockerDiagnosis: '', summary: 's' }
const call = (label) => effortCalls.find((c) => c.label.startsWith(label))

// Scenario A — plan-gated opus task, clean pass: planner medium, plan judge high, implementer
// medium, master review high; nothing escalates.
effortCalls.length = 0
ctx.agent = recordingAgent(async (prompt, opts) => {
  if (opts.label.startsWith('plan-judge:')) return { verdict: 'approve', feedback: [] }
  if (opts.label.startsWith('plan:')) return { ready: true, blocked: false, blockerCause: '', plan: 'PLAN\n### Gated inputs\nNone' }
  if (opts.phase === 'Implement') return greenImpl
  return { verdict: 'approve', feedback: [] } // review judge
})
const cleanOpus = await T.converge({ ...baseEff, slug: 'proj-eff-a', scope: 'cross-cutting', planGate: true }, aEff)
ok(cleanOpus && cleanOpus.status === 'review' && !cleanOpus.escalated, 'effort A: clean plan-gated opus task lands unescalated')
ok(call('plan:proj-eff-a') && call('plan:proj-eff-a').effort === 'medium' && call('plan:proj-eff-a').model === 'opus', 'effort A: planner runs medium @ opus')
ok(call('plan-judge:proj-eff-a') && call('plan-judge:proj-eff-a').effort === 'high', 'effort A: plan judge runs high (matrix)')
ok(call('implement:proj-eff-a') && call('implement:proj-eff-a').effort === 'medium' && call('implement:proj-eff-a').model === 'opus', 'effort A: implementer runs medium @ opus')
ok(call('review:proj-eff-a') && call('review:proj-eff-a').effort === 'high', 'effort A: master review runs high @ opus')

// Scenario B — escalation flip mid-task: the opus one-shot goes red (escalate=true), the fable
// takeover runs at high, and the master review — now at the fable tier — runs at xhigh.
effortCalls.length = 0
ctx.agent = recordingAgent(async (prompt, opts) => {
  if (opts.phase === 'Implement') {
    if (opts.label.endsWith('@fable')) return greenImpl
    return { verified: false, blocked: false, escalate: true, prUrl: '', branch: 'b', worktreePath: '/wt', blockerDiagnosis: 'red one-shot', summary: '' }
  }
  return { verdict: 'approve', feedback: [] }
})
const escRes = await T.converge({ ...baseEff, slug: 'proj-eff-b', scope: 'single-file', planGate: false }, aEff)
ok(escRes && escRes.status === 'review' && escRes.escalated && escRes.model === 'fable', 'effort B: red one-shot escalates and lands at fable')
ok(call('implement:proj-eff-b') && call('implement:proj-eff-b').effort === 'medium' && call('implement:proj-eff-b').model === 'opus', 'effort B: opus first pass runs medium')
ok(call('implement:proj-eff-b@fable') && call('implement:proj-eff-b@fable').effort === 'high' && call('implement:proj-eff-b@fable').model === 'fable', 'effort B: fable takeover runs high (bundle flips with the tier)')
ok(call('review:proj-eff-b') && call('review:proj-eff-b').effort === 'xhigh' && call('review:proj-eff-b').model === 'fable', 'effort B: master review after escalation runs xhigh @ fable')

// ---- maxTier ceiling (args.maxTier) -----------------------------------------
// The ceiling exists for one condition: the higher tier's quota is exhausted. Its whole promise is
// "the same run on a cheaper model", so the cases that matter are (a) absent ⇒ byte-identical, and
// (b) capped ⇒ still the FULL loop, not a silently weaker one-shot run.

// Parsing: only a genuinely absent value lifts the cap; a typo caps strictly rather than spending a
// quota the account does not have.
ok(T.tierCap({}) === 'fable' && T.tierCap(undefined) === 'fable' && T.tierCap({ maxTier: '' }) === 'fable', 'maxTier: absent/empty ⇒ uncapped (fable)')
ok(T.tierCap({ maxTier: 'opus' }) === 'opus' && T.tierCap({ maxTier: '  OPUS ' }) === 'opus', 'maxTier: case/whitespace-insensitive')
ok(T.tierCap({ maxTier: 'Opus5' }) === 'opus' && T.tierCap({ maxTier: 'fabel' }) === 'opus', 'maxTier: unrecognised value fails CLOSED to opus, never silently uncapped')

// clampTier is a ceiling, never a lift.
ok(T.clampTier('fable', 'opus') === 'opus', 'clampTier: above the cap clamps down')
ok(T.clampTier('opus', 'fable') === 'opus', 'clampTier: below the cap passes through (never raised)')
ok(T.taskModel({ model: 'fable' }, 'opus') === 'opus' && T.taskModel({ model: 'fable' }, 'fable') === 'fable', 'maxTier: seed clamped only under the cap')
ok(T.judgeFor({ judgeModel: 'fable' }, { tier: 'opus', cap: 'opus' }) === 'opus', 'maxTier: a judgeModel pin is clamped too')

// escalate() under the cap: no tier change, no escalated stamp (reconcile must not write a tier the
// account cannot use), and a durable capSuppressed marker so a block is not misread as a wall.
{
  const capped = { tier: 'opus', cap: 'opus', escalated: false, escalatedAt: '', capSuppressed: false }
  const moved = T.escalate(capped, 'x', 'plan')
  ok(moved === false && capped.tier === 'opus' && capped.escalated === false && capped.capSuppressed === true, 'maxTier: escalation suppressed, recorded, not stamped as an escalation')
  const free = { tier: 'opus', cap: 'fable', escalated: false, escalatedAt: '', capSuppressed: false }
  const moved2 = T.escalate(free, 'x', 'plan')
  ok(moved2 === true && free.tier === 'fable' && free.escalated === true && !free.capSuppressed, 'maxTier: absent ⇒ escalation behaves exactly as before')
}

// The regression this ceiling shipped with: a capped tier is TERMINAL, so it must render the full
// Ralph loop. Rendering the one-shot would give a capped run one verifier pass and zero fix
// iterations — strictly weaker than the run it replaces, with no stronger tier to hand over to.
{
  const ralph = T.verifyBlock(ST_FABLE, 'make test', 3, [])
  const capped = T.verifyBlock(ST_CAPPED, 'make test', 3, [])
  const firstPass = T.verifyBlock(ST_OPUS, 'make test', 3, [])
  ok(capped === ralph, 'maxTier: a capped opus tier renders the FULL Ralph loop, not the one-shot')
  ok(firstPass === T.oneShotVerify('make test', []), 'maxTier: absent ⇒ the opus first pass still gets the one-shot')
  ok(firstPass !== ralph, 'maxTier: the two verification blocks are genuinely different text')
  // An unrecognised tier is TERMINAL, so it keeps the full loop — the pre-ceiling default. A
  // terminality test must not invert what `tier === 'opus' ? oneShot : ralph` used to give.
  ok(T.verifyBlock({ tier: 'sonnet', cap: 'fable' }, 'make test', 3, []) === ralph, 'maxTier: an unrecognised tier still gets the full loop, never the one-shot')
}

// Effort is not quota-scarce: once an escalation is suppressed the task takes the higher tier's row.
ok(T.effortTier({ tier: 'opus', capSuppressed: true }) === 'fable' && T.effortTier({ tier: 'opus', capSuppressed: false }) === 'opus', 'maxTier: suppressed escalation keeps the higher tier EFFORT row')
ok(T.implEffort({ tier: 'opus', capSuppressed: true }, {}) === 'high', 'maxTier: capped implementer runs high, not medium')
ok(T.judgeEffort({}, { tier: 'opus', cap: 'opus', capSuppressed: true }, 'masterReview') === 'xhigh', 'maxTier: capped master review runs xhigh')

// A same-tier retry must not be told it is a stronger-tier takeover.
ok(T.escalationContext('diag', ST_CAPPED).includes('SECOND PASS') && !T.escalationContext('diag', ST_CAPPED).includes('STRONGER-TIER'), 'maxTier: capped retry says second pass, not stronger-tier takeover')
ok(T.escalationContext('diag', ST_FABLE).includes('STRONGER-TIER'), 'maxTier: a real escalation keeps the takeover framing')
ok(T.escalationContext('', ST_CAPPED) === '', 'maxTier: no prior ⇒ still empty (byte-identical)')
// The read-only second pass must not inherit the code-writing wording: no verification loop, no branch.
{
  const ro = T.escalationContext('diag', ST_CAPPED, 'readonly')
  ok(ro.includes('SECOND PASS') && !ro.includes('FULL verification loop') && !ro.includes('on your branch'), 'maxTier: read-only second pass keeps its read-only contract')
}

// CLASS closer: every builder derives its framing from st, so no call site can be forgotten (the
// plannerPrompt site was missed exactly this way and shipped green against a helper-only assertion).
{
  const aCap = { maxTier: 'opus', verifier: 'make test' }
  const tk = { slug: 'cap-sweep', scope: 'cross-cutting', maxIterations: 3 }
  const built = [
    T.plannerPrompt(tk, aCap, ST_CAPPED, 'prior diag'),
    T.implementerPrompt(tk, aCap, ST_CAPPED, 'prior diag'),
    T.approvedPlanImplementerPrompt(tk, 'PLAN', aCap, ST_CAPPED, 'prior diag'),
    T.readOnlyPrompt(tk, aCap, ST_CAPPED, 'prior diag'),
  ]
  ok(built.every((p) => !p.includes('STRONGER-TIER')), 'maxTier: NO builder promises a stronger-tier takeover under a cap')
  ok(built.every((p) => p.includes('SECOND PASS')), 'maxTier: every builder renders the second-pass framing under a cap')
  ok(T.plannerPrompt(tk, { verifier: 'make test' }, ST_FABLE, 'prior diag').includes('STRONGER-TIER')
    && T.implementerPrompt(tk, { verifier: 'make test' }, ST_FABLE, 'prior diag').includes('STRONGER-TIER'), 'maxTier: a real escalation still reads as a takeover in every builder')
}

// judgeModel is free-form operator input: normalised, clamped, never able to lift the cap.
ok(T.judgeFor({ judgeModel: 'Fable' }, { tier: 'opus', cap: 'opus' }) === 'opus', 'judgeModel: a case-variant pin is normalised then clamped')
ok(T.judgeFor({ judgeModel: '  fable  ' }, { tier: 'opus', cap: 'fable' }) === 'fable', 'judgeModel: whitespace tolerated when the cap allows it')
ok(T.judgeFor({ judgeModel: 'nonsense' }, { tier: 'opus', cap: 'fable' }) === 'opus', 'judgeModel: an unrecognised pin falls back to the task tier, never a guess')
ok(T.judgeEffort({ judgeModel: 'opus' }, { tier: 'opus', cap: 'opus', capSuppressed: true }, 'masterReview') === 'xhigh', 'judgeModel: pinning to the capped tier does not LOWER review effort')
ok(T.clampTier('sonnet', 'opus') === 'opus', 'clampTier: an unrecognised tier ranks at the top, so a cap clamps it down')

// Scenario C — per-task `effort: max` escape hatch on a plan-gated opus task: planner + implementer
// run at max, judges keep the matrix (plan judge high, master review high @ opus).
effortCalls.length = 0
ctx.agent = recordingAgent(async (prompt, opts) => {
  if (opts.label.startsWith('plan-judge:')) return { verdict: 'approve', feedback: [] }
  if (opts.label.startsWith('plan:')) return { ready: true, blocked: false, blockerCause: '', plan: 'PLAN\n### Gated inputs\nNone' }
  if (opts.phase === 'Implement') return greenImpl
  return { verdict: 'approve', feedback: [] }
})
await T.converge({ ...baseEff, slug: 'proj-eff-c', scope: 'cross-cutting', planGate: true, effort: 'max' }, aEff)
ok(call('plan:proj-eff-c') && call('plan:proj-eff-c').effort === 'max', 'effort C: effort override applies to the planner')
ok(call('implement:proj-eff-c') && call('implement:proj-eff-c').effort === 'max', 'effort C: effort override applies to the implementer')
ok(call('plan-judge:proj-eff-c') && call('plan-judge:proj-eff-c').effort === 'high', 'effort C: plan judge keeps the matrix (high) despite the override')
ok(call('review:proj-eff-c') && call('review:proj-eff-c').effort === 'high', 'effort C: master review keeps the matrix (high @ opus) despite the override')

// Scenario D — the override survives an escalation flip: implementer stays max on both tiers while
// the master review follows the matrix to xhigh.
effortCalls.length = 0
ctx.agent = recordingAgent(async (prompt, opts) => {
  if (opts.phase === 'Implement') {
    if (opts.label.endsWith('@fable')) return greenImpl
    return { verified: false, blocked: false, escalate: true, prUrl: '', branch: 'b', worktreePath: '/wt', blockerDiagnosis: 'red one-shot', summary: '' }
  }
  return { verdict: 'approve', feedback: [] }
})
await T.converge({ ...baseEff, slug: 'proj-eff-d', scope: 'single-file', planGate: false, effort: 'max' }, aEff)
ok(call('implement:proj-eff-d') && call('implement:proj-eff-d').effort === 'max', 'effort D: override holds on the opus first pass')
ok(call('implement:proj-eff-d@fable') && call('implement:proj-eff-d@fable').effort === 'max', 'effort D: override survives the fable takeover')
ok(call('review:proj-eff-d') && call('review:proj-eff-d').effort === 'xhigh', 'effort D: master review still follows the matrix (xhigh @ fable)')

// ---- Gated inputs (ADR 0008): a declared gate always pauses for a human -------
// The plan carries a REQUIRED "### Gated inputs" section (spend with a hard cap / credentials /
// irreversible actions, or exactly "None"). A non-empty declaration not covered by the task note's
// approved gates returns the task at status 'gate-pending' — regardless of plan_approval config or
// continuous mode — and NEVER escalates (a gate stop is a human decision, not evidence of hardness).
// Approved gates (task.approvedGates, read from the note's "## Approved gates") skip the stop for
// exactly those gates, so re-dispatches never re-ask.

// The requirement is ALWAYS rendered — in the planner, the plan-reviser, the plan-judge's checklist,
// and every code-writing prompt's stop rule (the plan_approval:false path).
const plPrompt = T.plannerPrompt(taskI, aI, ST_OPUS, '')
ok(plPrompt.includes('### Gated inputs'), 'plannerPrompt: always renders the Gated inputs requirement')
ok(/hard cap/i.test(plPrompt), 'plannerPrompt: spend gates require a hard cap')
const prvPrompt = T.planReviserPrompt(taskI, 'PLAN', [{ round: 1, feedback: ['x'] }], 2, aI)
ok(prvPrompt.includes('Gated inputs'), 'planReviserPrompt: required sub-sections include Gated inputs')
const pjPrompt = T.planJudgePrompt(taskI, 'PLAN', aI)
ok(pjPrompt.includes('Gated inputs') && /automatic "changes"/.test(pjPrompt), 'planJudgePrompt: missing Gated inputs section is an automatic changes')
ok(plPrompt.includes('BULLETS ONLY'), 'plannerPrompt: gated-inputs section forbids non-bullet prose')
ok(/non-bullet prose/.test(pjPrompt), 'planJudgePrompt: prose in the gated-inputs section is an automatic changes')
ok(/bullets only/i.test(prvPrompt), 'planReviserPrompt: revision keeps the bullets-only rule')
ok(pOpus.includes('Gated inputs (hard rule'), 'implementerPrompt: carries the gated-inputs stop rule')
ok(T.approvedPlanImplementerPrompt(taskI, 'PLAN', aI, ST_FABLE, '').includes('Gated inputs (hard rule'), 'approvedPlanImplementerPrompt: carries the stop rule')
ok(T.reviserPrompt(taskI, { prUrl: 'u', branch: 'b', worktreePath: '/wt' }, [{ round: 1, feedback: ['f'] }], 2, aI, '').includes('Gated inputs (hard rule'), 'reviserPrompt: carries the stop rule')

// Parser: None → [], list items → entries, missing section → null (fail-closed upstream). Only list
// items declare gates (ADR 0013, 2026-09-01 live failure): non-list prose is COMMENTARY, never a gate —
// a planner footnote after bullets restating approved gates must not manufacture a phantom gate. A
// section with NO list items and no "None" parses as null — a gate written only as prose never
// silently passes.
ok(T.parseGatedInputs('PLAN\n### Gated inputs\nNone\n### Risks / unknowns\nnone') !== null
  && T.parseGatedInputs('PLAN\n### Gated inputs\nNone\n### Risks / unknowns\nnone').length === 0,
  'parseGatedInputs: explicit None → empty declaration')
const parsed = T.parseGatedInputs('PLAN\n### Gated inputs\n- spend: Replicate API — cap USD 30\n- credential: PROD_API_KEY\n### Risks')
ok(parsed && parsed.length === 2 && parsed[0] === 'spend: Replicate API — cap USD 30', 'parseGatedInputs: bullets become gate entries')
ok(T.parseGatedInputs('PLAN with no section') === null, 'parseGatedInputs: missing section → null')
ok(T.parseGatedInputs('x\n## Gated inputs\n- a\n## next')[0] === 'a', 'parseGatedInputs: tolerates a ## heading level')
ok(T.unapprovedGates(['Spend: X — cap  USD 30'], ['spend: x — cap usd 30']).length === 0, 'unapprovedGates: match is case/whitespace-insensitive')
ok(T.unapprovedGates(['spend: x — cap usd 50'], ['spend: x — cap usd 30']).length === 1, 'unapprovedGates: a changed cap is a NEW gate')
const footnoted = T.parseGatedInputs('PLAN\n### Gated inputs\n- spend: Replicate API — cap USD 30\n- credential: PROD_API_KEY\n(Both restated verbatim from the task note\'s "## Approved gates" — no new gates.)\n### Risks')
ok(footnoted && footnoted.length === 2 && footnoted[1] === 'credential: PROD_API_KEY', 'parseGatedInputs: trailing prose footnote after bullets is not a gate')
ok(T.parseGatedInputs('PLAN\n### Gated inputs\nThe task needs prod credentials at some point.\n### Risks') === null, 'parseGatedInputs: prose-only section (no list items, no None) → null (fail-closed)')
const numbered = T.parseGatedInputs('PLAN\n### Gated inputs\n1. spend: Replicate API — cap USD 30\n2) credential: PROD_API_KEY\n### Risks')
ok(numbered && numbered.length === 2 && numbered[0] === 'spend: Replicate API — cap USD 30', 'parseGatedInputs: numbered-list items count as declarations, markers stripped')
ok(T.parseGatedInputs('PLAN\n### Gated inputs\n- None\n### Risks') !== null && T.parseGatedInputs('PLAN\n### Gated inputs\n- None\n### Risks').length === 0, 'parseGatedInputs: a bulleted None is the empty declaration')
ok(T.parseGatedInputs('PLAN\n### Gated inputs\nNone — the task is read-only.\n### Risks') === null, 'parseGatedInputs: an embellished None is not a clean declaration — fail-closed to null')
ok(T.parseGatedInputs('PLAN\n### Gated inputs\nNone yet, but the deploy step will need PROD_API_KEY.\n### Risks') === null, 'parseGatedInputs: None-prefixed prose that declares a need fails closed, never a silent pass')
const nested = T.parseGatedInputs('PLAN\n### Gated inputs\n- spend: Replicate API — cap USD 30\n- credential: PROD_API_KEY\n  - Both restated verbatim from the task note (no new gates.)\n### Risks')
ok(nested && nested.length === 2 && nested[1] === 'credential: PROD_API_KEY', 'parseGatedInputs: an indented sub-bullet is commentary, not a gate')
const wrapped = T.parseGatedInputs('PLAN\n### Gated inputs\n- spend: Replicate API for the full corpus re-render —\n  cap USD 30\n### Risks')
ok(wrapped && wrapped.length === 1 && wrapped[0] === 'spend: Replicate API for the full corpus re-render — cap USD 30', 'parseGatedInputs: a soft-wrapped gate keeps its cap (continuation rejoined)')

// Scenario gate-A — plan-gated task declares a gate: pauses at the plan-gate, nothing implemented.
effortCalls.length = 0
ctx.agent = recordingAgent(async (prompt, opts) => {
  if (opts.label.startsWith('plan-judge:')) return { verdict: 'approve', feedback: [] }
  if (opts.label.startsWith('plan:')) return { ready: true, blocked: false, blockerCause: '', plan: 'PLAN\n### Gated inputs\n- spend: Replicate API — cap USD 30' }
  if (opts.phase === 'Implement') return greenImpl
  return { verdict: 'approve', feedback: [] }
})
const gPlan = await T.converge({ ...baseEff, slug: 'proj-gate-a', scope: 'cross-cutting', planGate: true }, aEff)
ok(gPlan && gPlan.status === 'gate-pending', 'gate A: non-empty declaration pauses at the plan-gate (gate-pending)')
ok(gPlan.gatedInputs && gPlan.gatedInputs.length === 1 && /cap USD 30/.test(gPlan.gatedInputs[0]), 'gate A: the declared gate (with its cap) is surfaced')
ok(!call('implement:proj-gate-a'), 'gate A: no implementation dispatched before sign-off')
ok(!gPlan.escalated, 'gate A: a gate stop never escalates')

// Scenario gate-B — the same gate already approved on the note: NOT re-asked, task proceeds.
effortCalls.length = 0
const gApproved = await T.converge({ ...baseEff, slug: 'proj-gate-b', scope: 'cross-cutting', planGate: true, approvedGates: ['spend: Replicate API — cap USD 30'] }, aEff)
ok(gApproved && gApproved.status === 'review', 'gate B: an approved gate is not re-asked — the task lands')
ok(call('implement:proj-gate-b'), 'gate B: implementation proceeds past the approved gate')

// Scenario gate-C — plan_approval:false run: the IMPLEMENTER's declaration pauses the task too.
effortCalls.length = 0
ctx.agent = recordingAgent(async (prompt, opts) => {
  if (opts.phase === 'Implement') {
    return { verified: false, blocked: true, escalate: false, prUrl: '', branch: '', worktreePath: '/wt', blockerDiagnosis: 'needs the prod key', summary: '', gatedInputs: ['credential: PROD_API_KEY (read-only)'] }
  }
  return { verdict: 'approve', feedback: [] }
})
const gImpl = await T.converge({ ...baseEff, slug: 'proj-gate-c', scope: 'single-file', planGate: false }, aEff)
ok(gImpl && gImpl.status === 'gate-pending', 'gate C: an implementer-declared gate pauses a plan_approval:false run')
ok(gImpl.gatedInputs && gImpl.gatedInputs[0] === 'credential: PROD_API_KEY (read-only)', 'gate C: the declaration is surfaced verbatim')
ok(!gImpl.escalated && gImpl.model === 'opus', 'gate C: a gate stop on the opus first pass does not escalate')
ok(!call('implement:proj-gate-c@fable'), 'gate C: no fable takeover on a gate stop')

// Scenario gate-D — judge approved a plan WITHOUT the required section: fail-closed to plan-blocked
// (re-plan; no bogus sign-off request — there is nothing concrete to sign).
ctx.agent = recordingAgent(async (prompt, opts) => {
  if (opts.label.startsWith('plan-judge:')) return { verdict: 'approve', feedback: [] }
  if (opts.label.startsWith('plan:')) return { ready: true, blocked: false, blockerCause: '', plan: 'PLAN with no gated section' }
  if (opts.phase === 'Implement') return greenImpl
  return { verdict: 'approve', feedback: [] }
})
const gMissing = await T.converge({ ...baseEff, slug: 'proj-gate-d', scope: 'cross-cutting', planGate: true }, aEff)
ok(gMissing && gMissing.status === 'plan-blocked' && /Gated inputs/.test(gMissing.blockerDiagnosis), 'gate D: approved plan missing the section fails closed to plan-blocked')

// Scenario gate-E (2026-09-01 live failure, ADR 0013) — plan restates the approved gates as bullets then
// adds a prose footnote: the footnote is commentary, not a phantom gate — the task proceeds, no re-ask.
effortCalls.length = 0
ctx.agent = recordingAgent(async (prompt, opts) => {
  if (opts.label.startsWith('plan-judge:')) return { verdict: 'approve', feedback: [] }
  if (opts.label.startsWith('plan:')) return { ready: true, blocked: false, blockerCause: '', plan: 'PLAN\n### Gated inputs\n- spend: Replicate API — cap USD 30\n- credential: PROD_API_KEY\n(Both restated verbatim from the task note\'s "## Approved gates" — no new gates.)\n### Risks' }
  if (opts.phase === 'Implement') return greenImpl
  return { verdict: 'approve', feedback: [] }
})
const gFoot = await T.converge({ ...baseEff, slug: 'proj-gate-e', scope: 'cross-cutting', planGate: true, approvedGates: ['spend: Replicate API — cap USD 30', 'credential: PROD_API_KEY'] }, aEff)
ok(gFoot && gFoot.status === 'review', 'gate E: footnote after restated approved gates does not re-pause — the task lands')
ok(call('implement:proj-gate-e'), 'gate E: implementation proceeds (no spurious gate-pending)')

// Scenario gate-F — the section exists but declares a gate ONLY as prose: fail-closed to plan-blocked
// (a re-plan under the bullets-only prompt self-heals) — never a silent pass, never a bogus sign-off ask.
effortCalls.length = 0
ctx.agent = recordingAgent(async (prompt, opts) => {
  if (opts.label.startsWith('plan-judge:')) return { verdict: 'approve', feedback: [] }
  if (opts.label.startsWith('plan:')) return { ready: true, blocked: false, blockerCause: '', plan: 'PLAN\n### Gated inputs\nThe task will need about USD 30 of Replicate spend.\n### Risks' }
  if (opts.phase === 'Implement') return greenImpl
  return { verdict: 'approve', feedback: [] }
})
const gProse = await T.converge({ ...baseEff, slug: 'proj-gate-f', scope: 'cross-cutting', planGate: true }, aEff)
ok(gProse && gProse.status === 'plan-blocked' && /bullets/.test(gProse.blockerDiagnosis), 'gate F: prose-only declaration fails closed to plan-blocked, not gate-pending, not a silent pass')
ok(!call('implement:proj-gate-f'), 'gate F: nothing implemented on the malformed declaration')

// ---- Review-loop memory (2026-08-14): accumulated feedback + step-back + ceiling record ----
// The review loop mirrors planLoop's accumulation but with review semantics: the LATEST round is the
// reviser's work order, EARLIER rounds are anti-regression constraints (their fixes are committed on the
// branch), the judge gets the history plus an anti-goalpost discipline, the round-3+ reviser gets the
// step-back licence (with the original approved plan when the task was plan-gated), and both ceiling
// outcomes return the accumulated history for reconcile to persist.

const prevI = { prUrl: 'https://pr/1', branch: 'audit-fix/fix-x', worktreePath: '/wt' }
const h1 = [{ round: 1, feedback: ['fix the null check'] }]
const h2 = [{ round: 1, feedback: ['fix the null check'] }, { round: 2, feedback: ['add the test'] }]

ok(T.reviewHistoryBlock([]) === '' && T.reviewHistoryBlock(undefined) === '', 'reviewHistoryBlock: empty when unused')
const judgeEmpty = T.reviewJudgePrompt(taskI, prevI, aI, [])
ok(!/Prior review rounds|Discipline for this round/.test(judgeEmpty), 'reviewJudgePrompt: round-1 prompt carries no history block (byte-clean base)')
const judgeH = T.reviewJudgePrompt(taskI, prevI, aI, h2)
ok(judgeH.includes('Round 1 rejection') && judgeH.includes('Round 2 rejection'), 'reviewJudgePrompt: history renders grouped rounds')
ok(/could have raised in round 1/.test(judgeH), 'reviewJudgePrompt: anti-goalpost discipline present')
ok(judgeH.replace(T.reviewHistoryBlock(h2), '') === judgeEmpty, 'reviewJudgePrompt: with history == without + exactly the injected block')

const rev1 = T.reviserPrompt(taskI, prevI, h1, 2, aI, '')
ok(rev1.includes('ROUND 1 (your work order'), 'reviserPrompt: latest round labelled as the work order')
ok(!rev1.includes('ANTI-REGRESSION') && !rev1.includes('STEP-BACK'), 'reviserPrompt: round-2 reviser has no guard and no step-back')
ok(T.stepBackBlock(h1, '') === '', 'stepBackBlock: empty below the trigger (1 rejection)')

const rev2 = T.reviserPrompt(taskI, prevI, h2, 3, aI, '')
ok(rev2.includes('ROUND 2 (your work order'), 'reviserPrompt: round-3 work order is the LATEST round')
ok(rev2.includes('ANTI-REGRESSION') && rev2.includes('Round 1 rejection'), 'reviserPrompt: earlier rounds render as anti-regression constraints')
ok(rev2.includes('STEP-BACK ROUND'), 'reviserPrompt: step-back fires on the round-3 reviser (2 accumulated rejections)')
ok(rev2.includes(T.stepBackBlock(h2, '')), 'reviserPrompt: contains exactly the brief-only step-back block')

const revPlan = T.reviserPrompt(taskI, prevI, h2, 3, aI, 'THE APPROVED PLAN')
ok(revPlan.includes('THE APPROVED PLAN') && revPlan.includes('deviating from the approved plan'), 'reviserPrompt: step-back embeds the approved plan + deviation licence')
ok(revPlan.replace(T.stepBackBlock(h2, 'THE APPROVED PLAN'), '') === rev2.replace(T.stepBackBlock(h2, ''), ''), 'reviserPrompt: the plan changes ONLY the step-back block')

// Scenario memory-A — reject r1, reject r2, approve r3 at a 3-round ceiling: the r3 judge sees the
// history + discipline, the r3 reviser gets step-back + anti-regression, and the result records the
// ceiling approval with the full history.
const promptsA = {}
ctx.agent = async (prompt, opts) => {
  promptsA[opts.label] = prompt
  if (opts.phase === 'Implement') return greenImpl
  if (opts.label.startsWith('revise:')) return { ...greenImpl, summary: 'revised' }
  const m = opts.label.match(/ r(\d+)$/)
  if (m && Number(m[1]) <= 2) return { verdict: 'changes', feedback: [`bullet r${m[1]}`] }
  return { verdict: 'approve', feedback: [] }
}
const memA = await T.converge({ ...baseEff, slug: 'proj-mem-a', scope: 'single-file', planGate: false, maxReviewRounds: 3 }, aEff)
ok(memA && memA.status === 'review' && memA.reviewRoundsUsed === 3, 'memory A: converges to review on round 3')
ok(memA.approvedAtCeiling === true, 'memory A: final-round approval with history sets approvedAtCeiling')
ok(memA.reviewHistory.length === 2 && memA.reviewHistory[1].feedback[0] === 'bullet r2', 'memory A: result carries both rejection rounds')
ok(!promptsA['review:proj-mem-a r1'].includes('Prior review rounds'), 'memory A: round-1 judge prompt is history-free')
ok(promptsA['review:proj-mem-a r3'].includes('Round 1 rejection') && promptsA['review:proj-mem-a r3'].includes('Discipline for this round'), 'memory A: round-3 judge saw the accumulated history + discipline')
ok(promptsA['revise:proj-mem-a r2'] && !promptsA['revise:proj-mem-a r2'].includes('STEP-BACK'), 'memory A: round-2 reviser is a plain revision')
ok(promptsA['revise:proj-mem-a r3'].includes('STEP-BACK ROUND'), 'memory A: round-3 reviser got the step-back')
ok(promptsA['revise:proj-mem-a r3'].includes('ANTI-REGRESSION') && promptsA['revise:proj-mem-a r3'].includes('bullet r1'), 'memory A: round-3 reviser carries round 1 as anti-regression')

// Scenario memory-B — clean approve at a 1-round ceiling: round === max but NO history, so it is not
// a ceiling event and nothing is recorded.
ctx.agent = async (prompt, opts) => {
  if (opts.phase === 'Implement') return greenImpl
  return { verdict: 'approve', feedback: [] }
}
const memB = await T.converge({ ...baseEff, slug: 'proj-mem-b', scope: 'single-file', planGate: false, maxReviewRounds: 1 }, aEff)
ok(memB && memB.status === 'review' && memB.approvedAtCeiling === false && memB.reviewHistory.length === 0, 'memory B: clean approve at a 1-round ceiling is NOT a ceiling event')

// Scenario memory-C — reject at the ceiling (max 2): reviewFeedback keeps the latest bullets
// (back-compat) AND reviewHistory carries the full accumulated record for reconcile.
ctx.agent = async (prompt, opts) => {
  if (opts.phase === 'Implement') return greenImpl
  if (opts.label.startsWith('revise:')) return { ...greenImpl, summary: 'revised' }
  const m = opts.label.match(/ r(\d+)$/)
  return { verdict: 'changes', feedback: [`bullet r${m ? m[1] : '?'}`] }
}
const memC = await T.converge({ ...baseEff, slug: 'proj-mem-c', scope: 'single-file', planGate: false }, aEff)
ok(memC && memC.status === 'review-blocked' && memC.reviewRoundsUsed === 2, 'memory C: rides to the 2-round ceiling review-blocked')
ok(memC.reviewFeedback[0] === 'bullet r2', 'memory C: reviewFeedback keeps the latest bullets (back-compat)')
ok(memC.reviewHistory.length === 2 && memC.reviewHistory[0].feedback[0] === 'bullet r1', 'memory C: reviewHistory carries the full accumulated record')

// Scenario memory-D — plan-gated: the ORIGINAL approved plan rides into the round-3 step-back only.
const promptsD = {}
ctx.agent = async (prompt, opts) => {
  promptsD[opts.label] = prompt
  if (opts.label.startsWith('plan-judge:')) return { verdict: 'approve', feedback: [] }
  if (opts.label.startsWith('plan:')) return { ready: true, blocked: false, blockerCause: '', plan: 'GRAND DESIGN\n### Gated inputs\nNone' }
  if (opts.phase === 'Implement') return greenImpl
  if (opts.label.startsWith('revise:')) return { ...greenImpl, summary: 'revised' }
  const m = opts.label.match(/ r(\d+)$/)
  if (m && Number(m[1]) <= 2) return { verdict: 'changes', feedback: [`bullet r${m[1]}`] }
  return { verdict: 'approve', feedback: [] }
}
const memD = await T.converge({ ...baseEff, slug: 'proj-mem-d', scope: 'cross-cutting', planGate: true, maxReviewRounds: 3 }, aEff)
ok(memD && memD.status === 'review' && memD.approvedAtCeiling === true, 'memory D: plan-gated task lands at the ceiling')
ok(promptsD['revise:proj-mem-d r3'].includes('GRAND DESIGN') && promptsD['revise:proj-mem-d r3'].includes('reference, not law'), 'memory D: step-back embeds the ORIGINAL approved plan')
ok(promptsD['revise:proj-mem-d r2'] && !promptsD['revise:proj-mem-d r2'].includes('GRAND DESIGN'), 'memory D: the pre-step-back reviser does not carry the plan')

// ---- Transient agent death: null-return hardening ----------------------------
// Observed 2026-07-18 (narcissus-avp): implementer agents died mid-run on "API Error: Connection closed
// mid-response". agent() returns null on such a terminal error; unguarded, the null flowed into reviewLoop
// and threw `null is not an object (evaluating 'prevImpl.prUrl')`, then got reported with the useless
// generic "workflow stage threw" diagnosis. These assert runAgent's retry + sentinel and every layer's
// CLEAN, CLASSIFIED transient block. `agent` is swapped on ctx per case (resolved against the sandbox global
// at call time). Uses top-level await (this is an ESM module).

// runAgent: retries exactly once on a null return, then returns the { __dead: true } sentinel.
let deadCalls = 0
ctx.agent = async () => { deadCalls++; return null }
const dead = await T.runAgent('p', { label: 'x' })
ok(dead && dead.__dead === true, 'runAgent: returns { __dead:true } sentinel when the agent stays dead')
ok(deadCalls === 2, 'runAgent: one automatic retry on null (2 dispatches total)')

// runAgent: a live result on the first try is returned as-is, no retry.
let liveCalls = 0
ctx.agent = async () => { liveCalls++; return { verified: true } }
const live = await T.runAgent('p', { label: 'x' })
ok(live && live.verified === true && liveCalls === 1, 'runAgent: live first result returned as-is, no retry')

// runAgent: null then a live result on the retry recovers (the common transient case).
let mixCalls = 0
ctx.agent = async () => { mixCalls++; return mixCalls === 1 ? null : { verified: true } }
const recovered = await T.runAgent('p', { label: 'x' })
ok(recovered && recovered.verified === true && !recovered.__dead && mixCalls === 2, 'runAgent: recovers when the retry succeeds')

const aT = { repoPath: '/repo', rolloutSlug: 'proj-rollout', verifier: 'make test' }
const baseTask = { taskPath: '/v/t.md', maxIterations: 3, maxReviewRounds: 2, maxPlanRounds: 2 }

// REGRESSION: a dead implementer must NOT throw in reviewLoop and must report a classified transient block.
ctx.agent = async () => null
const taskImpl = { ...baseTask, slug: 'proj-fix-x', scope: 'single-file', planGate: false }
let threw = false, implRes
try { implRes = await T.converge(taskImpl, aT) } catch (e) { threw = true }
ok(!threw, 'converge: dead implementer does not throw (regression: prevImpl.prUrl on a null)')
ok(implRes && implRes.status === 'blocked', 'converge: dead implementer → status blocked')
ok(implRes && /transient infrastructure/i.test(implRes.blockerDiagnosis), 'converge: dead implementer → transient-infra diagnosis (not "workflow stage threw")')

// A dead planner on a plan-gated task → plan-blocked with the transient diagnosis, no throw.
ctx.agent = async () => null
const taskPlan = { ...baseTask, slug: 'proj-fix-y', scope: 'single-file', planGate: true }
let planThrew = false, planRes
try { planRes = await T.converge(taskPlan, aT) } catch (e) { planThrew = true }
ok(!planThrew, 'converge: dead planner does not throw')
ok(planRes && planRes.status === 'plan-blocked', 'converge: dead planner → status plan-blocked')
ok(planRes && /transient infrastructure/i.test(planRes.blockerDiagnosis), 'converge: dead planner → transient-infra diagnosis')

// Implementer succeeds + opens a PR, then the review-judge dies → blocked, transient diagnosis, PR preserved.
ctx.agent = async (prompt, opts) => {
  if (opts.phase === 'Implement') {
    return { verified: true, blocked: false, escalate: false, prUrl: 'https://pr/1', branch: 'audit-fix/fix-z', worktreePath: '/wt', blockerDiagnosis: '', summary: 'done' }
  }
  return null // the review judge dies
}
const taskRev = { ...baseTask, slug: 'proj-fix-z', scope: 'single-file', planGate: false }
let revThrew = false, revRes
try { revRes = await T.converge(taskRev, aT) } catch (e) { revThrew = true }
ok(!revThrew, 'converge: dead review-judge does not throw')
ok(revRes && revRes.status === 'blocked', 'converge: dead review-judge → status blocked')
ok(revRes && /transient infrastructure/i.test(revRes.blockerDiagnosis), 'converge: dead review-judge → transient-infra diagnosis')
ok(revRes && revRes.prUrl === 'https://pr/1', 'converge: dead review-judge preserves the open PR url')

// A dead read-only investigator → blocked (NOT a spurious clean "review"), no throw.
ctx.agent = async () => null
const taskRO = { ...baseTask, slug: 'proj-audit', scope: 'read-only', planGate: false }
let roThrew = false, roRes
try { roRes = await T.converge(taskRO, aT) } catch (e) { roThrew = true }
ok(!roThrew, 'converge: dead read-only investigator does not throw')
ok(roRes && roRes.status === 'blocked', 'converge: dead read-only investigator → blocked, not spurious review')
ok(roRes && /transient infrastructure/i.test(roRes.blockerDiagnosis), 'converge: dead read-only investigator → transient-infra diagnosis')

// ---- Progress / ETA (wave-boundary timestamps — the engine has no clock) ------
// The Workflow sandbox cannot read clocks (Date.now() throws), so wave-boundary timestamps are stamped
// on the ROLLOUT NOTE by reconcile-wave.py (mark-dispatched at wave launch, cursor post-merge) and the
// skill threads a precomputed `progress` line into args for the engine to relay via log(). Comments may
// NAME Date.now(); code must never CALL it — strip line comments before scanning.
const codeOnly = src.replace(/\/\/[^\n]*/g, '')
ok(!/\bDate\s*\.\s*now\b|\bnew\s+Date\b/.test(codeOnly), 'engine: no clock reads — Date is unavailable in the Workflow sandbox')
ok(src.includes('if (a.progress) log(a.progress)'), 'engine: relays the precomputed progress line (absent ⇒ byte-identical logs)')

console.log()
console.log(fail === 0 ? 'ALL PASS' : 'SOME FAILED')
process.exit(fail)
