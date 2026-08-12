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
//                               leaves behaviour identical (zero-touch).
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
head += '\nvar __t = { gateOverride, envBootstrapStep, worktreeSetup, escalationContext, verifyBlock, oneShotVerify, ralphLoop, implementerPrompt, plannerPrompt, planReviserPrompt, planJudgePrompt, approvedPlanImplementerPrompt, reviserPrompt, parseGatedInputs, unapprovedGates, runAgent, planLoop, implement, reviewLoop, converge, EFFORT, implEffort, judgeEffort };\n'

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

ok(T.escalationContext('') === '', 'escalationContext: empty when unused (empty string)')
ok(T.escalationContext(undefined) === '', 'escalationContext: empty when unused (undefined)')
ok(T.escalationContext('diag').includes('ESCALATION'), 'escalationContext: hand-over block when set')

const vOpus = T.verifyBlock('opus', 'make test', 3, undefined)
const vFable = T.verifyBlock('fable', 'make test', 3, undefined)
ok(vOpus.includes('ONE-SHOT') && !vOpus.includes('Max iterations'), 'verifyBlock: opus = one-shot, no iteration budget')
ok(vOpus.includes('escalate=true'), 'verifyBlock: one-shot instructs the escalate signal on red')
ok(vFable.includes('Max iterations: 3') && !vFable.includes('ONE-SHOT'), 'verifyBlock: fable = full Ralph loop')
ok(vFable === T.ralphLoop('make test', 3, undefined), 'verifyBlock: fable arm is byte-identical to ralphLoop (resume-cache)')

const vOpusB = T.verifyBlock('opus', 'make test', 3, ['test_x — env'])
ok(vOpusB.includes('KNOWN BASELINE FAILURES') && vOpusB.includes('test_x — env'), 'oneShotVerify: baseline arm renders the manifest')

const taskI = { slug: 'proj-fix-x', taskPath: '/vault/proj-fix-x.md', ignoreGate: false, maxIterations: 3 }
const aI = { repoPath: '/repo', rolloutSlug: 'proj-rollout', verifier: 'make test' }
const pOpus = T.implementerPrompt(taskI, aI, 'opus', '')
const pFable = T.implementerPrompt(taskI, aI, 'fable', '')
ok(pOpus.includes('ONE-SHOT') && !pOpus.includes('Max iterations'), 'implementerPrompt: opus tier renders the one-shot block')
ok(pFable.includes('Max iterations: 3') && !pFable.includes('ONE-SHOT'), 'implementerPrompt: fable tier renders the Ralph loop')
const prior = 'the verifier failed on test_y'
const pPrior = T.implementerPrompt(taskI, aI, 'fable', prior)
ok(pPrior.includes('ESCALATION'), 'implementerPrompt: escalation context present when prior set')
ok(pPrior.replace(T.escalationContext(prior), '') === pFable, 'implementerPrompt: with prior == without + exactly the injected block (byte-identical base)')

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
const plPrompt = T.plannerPrompt(taskI, aI, '')
ok(plPrompt.includes('### Gated inputs'), 'plannerPrompt: always renders the Gated inputs requirement')
ok(/hard cap/i.test(plPrompt), 'plannerPrompt: spend gates require a hard cap')
const prvPrompt = T.planReviserPrompt(taskI, 'PLAN', [{ round: 1, feedback: ['x'] }], 2, aI)
ok(prvPrompt.includes('Gated inputs'), 'planReviserPrompt: required sub-sections include Gated inputs')
const pjPrompt = T.planJudgePrompt(taskI, 'PLAN', aI)
ok(pjPrompt.includes('Gated inputs') && /automatic "changes"/.test(pjPrompt), 'planJudgePrompt: missing Gated inputs section is an automatic changes')
ok(pOpus.includes('Gated inputs (hard rule'), 'implementerPrompt: carries the gated-inputs stop rule')
ok(T.approvedPlanImplementerPrompt(taskI, 'PLAN', aI, 'fable', '').includes('Gated inputs (hard rule'), 'approvedPlanImplementerPrompt: carries the stop rule')
ok(T.reviserPrompt(taskI, { prUrl: 'u', branch: 'b', worktreePath: '/wt' }, ['f'], 2, aI).includes('Gated inputs (hard rule'), 'reviserPrompt: carries the stop rule')

// Parser: None → [], bullets → entries, missing section → null (fail-closed upstream).
ok(T.parseGatedInputs('PLAN\n### Gated inputs\nNone\n### Risks / unknowns\nnone') !== null
  && T.parseGatedInputs('PLAN\n### Gated inputs\nNone\n### Risks / unknowns\nnone').length === 0,
  'parseGatedInputs: explicit None → empty declaration')
const parsed = T.parseGatedInputs('PLAN\n### Gated inputs\n- spend: Replicate API — cap USD 30\n- credential: PROD_API_KEY\n### Risks')
ok(parsed && parsed.length === 2 && parsed[0] === 'spend: Replicate API — cap USD 30', 'parseGatedInputs: bullets become gate entries')
ok(T.parseGatedInputs('PLAN with no section') === null, 'parseGatedInputs: missing section → null')
ok(T.parseGatedInputs('x\n## Gated inputs\n- a\n## next')[0] === 'a', 'parseGatedInputs: tolerates a ## heading level')
ok(T.unapprovedGates(['Spend: X — cap  USD 30'], ['spend: x — cap usd 30']).length === 0, 'unapprovedGates: match is case/whitespace-insensitive')
ok(T.unapprovedGates(['spend: x — cap usd 50'], ['spend: x — cap usd 30']).length === 1, 'unapprovedGates: a changed cap is a NEW gate')

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
