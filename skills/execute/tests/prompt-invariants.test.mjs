// Verifies the resume-cache invariant for the optional features in task.workflow.js:
//   - gateOverride(task)      → '' when ignoreGate is unset (byte-identical prompts), text when set
//   - envBootstrapStep(a)     → '' when envBootstrap is unset, a command line when set
//   - worktreeSetup(a, task)  → identical to its pre-feature output when envBootstrap is unset; when set,
//                               it equals the unset output PLUS exactly the injected bootstrap line.
//   - escalationContext(prior)→ '' when prior is empty, hand-over block when set; a prompt with prior
//                               equals the prior-less prompt PLUS exactly the injected block.
//   - verifyBlock(st, …)      → a first pass below the top rung renders the ONE-SHOT block (no iteration);
//                               the pass after the stage's climb, and every top-rung pass, the full Ralph loop.
//   - the ladder (ADR 0029)   → every role's effort is the current rung's; each stage climbs once; a top-rung
//                               retry is a same-rung second pass at CAPPED_RETRY_ITERATIONS.
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
import crypto from 'node:crypto'
import { loadEngine, runTask } from '../../../tests/lib/engine.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(here, '..', 'task.workflow.js'), 'utf8')

const marker = '// ---- Orchestration'
const idx = src.indexOf(marker)
if (idx === -1) { console.error('FAIL - orchestration marker not found'); process.exit(1) }
let head = src.slice(0, idx).replace('export const meta', 'const meta')
head += '\nvar __t = { gateOverride, envBootstrapStep, worktreeSetup, escalationContext, verifyBlock, oneShotVerify, ralphLoop, implementerPrompt, plannerPrompt, planReviserPrompt, planJudgePrompt, approvedPlanImplementerPrompt, reviewJudgePrompt, reviserPrompt, groupedRounds, reviewHistoryBlock, stepBackBlock, parseGatedInputs, unapprovedGates, runAgent, planLoop, implement, reviewLoop, converge, BUILT_IN_LADDER, CAPPED_RETRY_ITERATIONS, rungState, startRung, cur, onTop, climbOf, implEffort, judgeEffort, escalate, readOnlyPrompt, roundBudgetDiagnosis, taskTreeSetup };\n'

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

// ---- The ladder (ADR 0029): one-shot below the top, a climb per stage, the top rung's second pass ----

// State doubles, built by rungState() and escalate() exactly as converge() builds them, on the built-in
// ladder (opus-high, then opus-xhigh). ST_BOTTOM is a first pass below the top; ST_CLIMBED is after a real
// implement climb (now on the top rung); ST_PLAN_CLIMBED after a real plan climb; ST_TOP a task that
// started on the top rung, whose plan and implement climbs were recorded as no-ops.
const stOf = (task, a, stages = []) => {
  const st = T.rungState({ slug: 'proj-fix-x', ...task }, a)
  for (const s of stages) T.escalate(st, 'proj-fix-x', s)
  return st
}
const ST_BOTTOM = stOf({}, {})
const ST_CLIMBED = stOf({}, {}, ['implement'])
const ST_PLAN_CLIMBED = stOf({}, {}, ['plan'])
const ST_TOP = stOf({ rung: 'opus-xhigh' }, {}, ['plan', 'implement'])
ok(T.escalationContext('', ST_BOTTOM, 'implement') === '', 'escalationContext: empty when unused (empty string)')
ok(T.escalationContext(undefined, ST_CLIMBED, 'implement') === '', 'escalationContext: empty when unused (undefined)')
ok(T.escalationContext('diag', ST_CLIMBED, 'implement').includes('ESCALATION: you take this task over ONE RUNG UP'), 'escalationContext: a real climb is a takeover one rung up')

const vBottom = T.verifyBlock(ST_BOTTOM, 'make test', 3, undefined)
const vClimbed = T.verifyBlock(ST_CLIMBED, 'make test', 3, undefined)
ok(vBottom.includes('ONE-SHOT') && !vBottom.includes('Max iterations'), 'verifyBlock: a first pass below the top = one-shot, no iteration budget')
ok(vBottom.includes('escalate=true') && vBottom.includes('next rung'), 'verifyBlock: the one-shot instructs the escalate signal on red, for the next rung')
ok(vClimbed.includes('Max iterations: 3') && !vClimbed.includes('ONE-SHOT'), 'verifyBlock: after the implement climb = full Ralph loop')
ok(vClimbed === T.ralphLoop('make test', 3, undefined), 'verifyBlock: the loop arm is byte-identical to ralphLoop (resume-cache)')

const vBottomB = T.verifyBlock(ST_BOTTOM, 'make test', 3, ['test_x — env'])
ok(vBottomB.includes('KNOWN BASELINE FAILURES') && vBottomB.includes('test_x — env'), 'oneShotVerify: baseline arm renders the manifest')

const taskI = { slug: 'proj-fix-x', taskPath: '/vault/proj-fix-x.md', ignoreGate: false, maxIterations: 3 }
const aI = { repoPath: '/repo', rolloutSlug: 'proj-rollout', verifier: 'make test' }
const pBottom = T.implementerPrompt(taskI, aI, ST_BOTTOM, '')
const pClimbed = T.implementerPrompt(taskI, aI, ST_CLIMBED, '')
ok(pBottom.includes('ONE-SHOT') && !pBottom.includes('Max iterations'), 'implementerPrompt: a bottom-rung first pass renders the one-shot block')
ok(pClimbed.includes('Max iterations: 3') && !pClimbed.includes('ONE-SHOT'), 'implementerPrompt: after the climb it renders the Ralph loop')
const prior = 'the verifier failed on test_y'
const pPrior = T.implementerPrompt(taskI, aI, ST_CLIMBED, prior)
ok(pPrior.includes('ONE RUNG UP'), 'implementerPrompt: the takeover context is present when prior set')
ok(pPrior.replace(T.escalationContext(prior, ST_CLIMBED, 'implement'), '') === pClimbed, 'implementerPrompt: with prior == without + exactly the injected block (byte-identical base)')

// ---- Efforts ride the rung (ADR 0029: the ladder replaces the engine's effort matrix) ----
// A rung is a model plus three efforts: `effort` (the code-writing roles — planner, plan reviser,
// implementer, reviser, read-only investigator), `judge` (the plan gate) and `review` (the master review).
// The built-in ladder: opus-high (high / high / xhigh), then opus-xhigh (xhigh / high / xhigh). A climb
// moves every role at once, judges included.
ok(JSON.stringify(T.BUILT_IN_LADDER) === JSON.stringify({ source: 'built-in', rungs: [
  { name: 'opus-high', model: 'opus', effort: 'high', judge: 'high', review: 'xhigh' },
  { name: 'opus-xhigh', model: 'opus', effort: 'xhigh', judge: 'high', review: 'xhigh' },
] }), 'BUILT_IN_LADDER: two Opus rungs, high then xhigh, nothing above Opus, no max')
ok(T.implEffort(ST_BOTTOM) === 'high' && T.implEffort(ST_CLIMBED) === 'xhigh', 'implEffort: the current rung\'s effort (high, then xhigh after a climb)')
ok(T.judgeEffort(ST_BOTTOM, 'judge') === 'high' && T.judgeEffort(ST_CLIMBED, 'judge') === 'high', 'judgeEffort: the plan judge at the current rung\'s judge effort')
ok(T.judgeEffort(ST_BOTTOM, 'review') === 'xhigh' && T.judgeEffort(ST_CLIMBED, 'review') === 'xhigh', 'judgeEffort: the master review at the current rung\'s review effort')

// No rollout-level effort config, deliberately (ADR 0007's stance, now the operator's ladder): the rollout
// template must never grow an `effort:` key.
const tpl = fs.readFileSync(path.join(here, '..', '..', 'schedule', 'rollout-template.md'), 'utf8')
ok(!/\beffort\s*:/i.test(tpl), 'rollout template: no effort: key (no rollout-level effort config)')

// End-to-end: every spawn site passes its role's effort on the task's CURRENT rung.
// ctx.agent records (label, model, effort) per dispatch; converge() drives all three layers.
const aEff = { repoPath: '/repo', rolloutSlug: 'proj-rollout', verifier: 'make test' }
const baseEff = { taskPath: '/v/t.md', maxIterations: 3, maxReviewRounds: 2, maxPlanRounds: 2 }
const effortCalls = []
function recordingAgent(impl) {
  return async (prompt, opts) => {
    effortCalls.push({ label: opts.label, model: opts.model, effort: opts.effort, prompt })
    return impl(prompt, opts)
  }
}
const greenImpl = { verified: true, blocked: false, escalate: false, prUrl: 'https://pr/9', branch: 'b', worktreePath: '/wt', blockerDiagnosis: '', summary: 's' }
const call = (label) => effortCalls.find((c) => c.label.startsWith(label))
// Exact-match sibling: `call` is a PREFIX match, so it cannot distinguish a first pass from
// its `@<rung>` retry. Use callAt when the retry is the subject.
const callAt = (label) => effortCalls.find((c) => c.label === label)

// Scenario A — plan-gated bottom task, clean pass: planner high, plan judge high, implementer high (one-shot),
// master review xhigh; nothing climbs.
effortCalls.length = 0
ctx.agent = recordingAgent(async (prompt, opts) => {
  if (opts.label.startsWith('plan-judge:')) return { verdict: 'approve', feedback: [] }
  if (opts.label.startsWith('plan:')) return { ready: true, blocked: false, blockerCause: '', plan: 'PLAN\n### Gated inputs\nNone' }
  if (opts.phase === 'Implement') return greenImpl
  return { verdict: 'approve', feedback: [] } // review judge
})
const cleanBottom = await T.converge({ ...baseEff, slug: 'proj-eff-a', scope: 'cross-cutting', planGate: true }, aEff)
ok(cleanBottom && cleanBottom.status === 'review' && cleanBottom.climbs.length === 0 && cleanBottom.rung === 'opus-high', 'effort A: a clean plan-gated bottom task lands on the bottom rung, no climb')
ok(call('plan:proj-eff-a') && call('plan:proj-eff-a').effort === 'high' && call('plan:proj-eff-a').model === 'opus', 'effort A: planner runs high @ opus')
ok(call('plan-judge:proj-eff-a') && call('plan-judge:proj-eff-a').effort === 'high', 'effort A: plan judge runs at the rung\'s judge effort (high)')
ok(call('implement:proj-eff-a') && call('implement:proj-eff-a').effort === 'high' && call('implement:proj-eff-a').model === 'opus', 'effort A: implementer runs high @ opus')
ok(call('review:proj-eff-a') && call('review:proj-eff-a').effort === 'xhigh', 'effort A: master review runs at the rung\'s review effort (xhigh)')

// Scenario B — a climb mid-task: the bottom one-shot goes red (escalate=true), the opus-xhigh takeover runs
// at xhigh, and the master review runs on the reached rung.
effortCalls.length = 0
ctx.agent = recordingAgent(async (prompt, opts) => {
  if (opts.phase === 'Implement') {
    if (opts.label.endsWith('@opus-xhigh')) return greenImpl
    return { verified: false, blocked: false, escalate: true, prUrl: '', branch: 'b', worktreePath: '/wt', blockerDiagnosis: 'red one-shot', summary: '' }
  }
  return { verdict: 'approve', feedback: [] }
})
const escRes = await T.converge({ ...baseEff, slug: 'proj-eff-b', scope: 'single-file', planGate: false }, aEff)
ok(escRes && escRes.status === 'review' && escRes.rung === 'opus-xhigh' && JSON.stringify(escRes.climbs) === JSON.stringify([{ stage: 'implement', from: 'opus-high', to: 'opus-xhigh' }]), 'effort B: a red one-shot climbs and lands on opus-xhigh')
ok(call('implement:proj-eff-b') && call('implement:proj-eff-b').effort === 'high', 'effort B: the bottom first pass runs high')
ok(callAt('implement:proj-eff-b@opus-xhigh') && callAt('implement:proj-eff-b@opus-xhigh').effort === 'xhigh', 'effort B: the takeover runs at the reached rung\'s effort (xhigh)')
ok(call('review:proj-eff-b') && call('review:proj-eff-b').effort === 'xhigh' && call('review:proj-eff-b').model === 'opus', 'effort B: the master review runs on the reached rung')
// The retry after a real climb keeps the FULL iteration budget — that is what the hand-over buys. Only a
// top-rung retry (a recorded no-op climb) gets the reduced constant. Without this, dropping implement()'s
// `moved ?` guard silently halves every real climb and ships green.
ok(callAt('implement:proj-eff-b@opus-xhigh') && callAt('implement:proj-eff-b@opus-xhigh').prompt.includes('Max iterations: 3'), 'effort B: a REAL climb keeps the FULL max_iterations, never the top-rung retry constant')

// Scenario C — the legacy `effort: max` stamp on a note with no `rung:`: it only picks the starting rung (the
// top), and no dispatch ever runs at max.
effortCalls.length = 0
ctx.agent = recordingAgent(async (prompt, opts) => {
  if (opts.label.startsWith('plan-judge:')) return { verdict: 'approve', feedback: [] }
  if (opts.label.startsWith('plan:')) return { ready: true, blocked: false, blockerCause: '', plan: 'PLAN\n### Gated inputs\nNone' }
  if (opts.phase === 'Implement') return greenImpl
  return { verdict: 'approve', feedback: [] }
})
const legacyMax = await T.converge({ ...baseEff, slug: 'proj-eff-c', scope: 'cross-cutting', planGate: true, effort: 'max' }, aEff)
ok(legacyMax && legacyMax.startRung === 'opus-xhigh' && legacyMax.rung === 'opus-xhigh', 'effort C: a legacy effort: max starts on the top rung')
ok(effortCalls.length === 4 && effortCalls.every((c) => c.effort !== 'max' && c.model === 'opus'), 'effort C: no dispatch runs at max or off the ladder')
ok(call('plan:proj-eff-c').effort === 'xhigh' && call('implement:proj-eff-c').effort === 'xhigh' && call('plan-judge:proj-eff-c').effort === 'high' && call('review:proj-eff-c').effort === 'xhigh', 'effort C: every role at the top rung\'s efforts')
ok(!call('implement:proj-eff-c').prompt.includes('EXACTLY ONCE'), 'effort C: the top rung\'s first pass runs the full loop')

// ---- The rung sweep: verify shape, framing and efforts at every rung ---------------------------------------
// A three-rung ladder whose efforts all differ, so a role reading the wrong rung shows.
const L3 = { source: '/home/x/.config/thread/ladder.toml', rungs: [
  { name: 'r-low', model: 'opus', effort: 'low', judge: 'medium', review: 'high' },
  { name: 'r-mid', model: 'opus', effort: 'medium', judge: 'high', review: 'xhigh' },
  { name: 'r-top', model: 'fable', effort: 'high', judge: 'xhigh', review: 'max' },
] }
const a3 = { ladder: L3 }
for (let i = 0; i < 3; i++) {
  const name = L3.rungs[i].name
  const at = stOf({ rung: name }, a3)
  ok(T.cur(at).name === name && T.onTop(at) === (i === 2), `rung sweep: ${name} — the state starts there`)
  ok(T.implEffort(at) === L3.rungs[i].effort && T.judgeEffort(at, 'judge') === L3.rungs[i].judge && T.judgeEffort(at, 'review') === L3.rungs[i].review,
    `rung sweep: ${name} — every role takes this rung's effort`)
  const first = T.verifyBlock(at, 'make test', 3, [])
  ok(first === (i < 2 ? T.oneShotVerify('make test', []) : T.ralphLoop('make test', 3, [])), `rung sweep: ${name} — the implement first pass is ${i < 2 ? 'one-shot' : 'the full loop (top rung)'}`)
  const after = stOf({ rung: name }, a3, ['implement'])
  ok(T.verifyBlock(after, 'make test', 3, []) === T.ralphLoop('make test', 3, []), `rung sweep: ${name} — the pass after the implement climb runs the full loop`)
  ok(T.cur(after).name === L3.rungs[Math.min(i + 1, 2)].name, `rung sweep: ${name} — the climb moves one rung, never past the top`)
  const planUp = stOf({ rung: name }, a3, ['plan'])
  const stillBelow = Math.min(i + 1, 2) < 2
  ok(T.verifyBlock(planUp, 'make test', 3, []) === (stillBelow ? T.oneShotVerify('make test', []) : T.ralphLoop('make test', 3, [])),
    `rung sweep: ${name} — after a plan climb the implement first pass is ${stillBelow ? 'still one-shot (below the top)' : 'the full loop (now on the top)'}`)
}
// escalate(): once per stage per call, never past the top, a recorded no-op there; it returns whether it moved.
{
  const st = stOf({}, a3)
  const moves = [T.escalate(st, 'x', 'plan'), T.escalate(st, 'x', 'plan'), T.escalate(st, 'x', 'implement'), T.escalate(st, 'x', 'implement'), T.escalate(st, 'x', 'review')]
  ok(JSON.stringify(moves) === JSON.stringify([true, false, true, false, false]), 'escalate: moves once per stage, and not at all on the top rung')
  ok(JSON.stringify(st.climbs) === JSON.stringify([{ stage: 'plan', from: 'r-low', to: 'r-mid' }, { stage: 'implement', from: 'r-mid', to: 'r-top' }, { stage: 'review', from: 'r-top', to: 'r-top' }]),
    'escalate: each stage recorded once; the top-rung climb is a recorded no-op (from === to)')
  ok(T.cur(st).name === 'r-top' && T.onTop(st), 'escalate: never past the top')
}
// The framing reads the builder's OWN stage: a real climb is a takeover one rung up; a no-op climb on the
// top rung is a same-rung second pass. CLASS closer: every builder that takes a prior derives its framing
// from st (the plannerPrompt site was once missed exactly this way and shipped green against a helper-only
// assertion).
{
  const tk = { slug: 'rung-sweep', scope: 'cross-cutting', maxIterations: 3 }
  const av = { verifier: 'make test' }
  const builders = (stPlan, stImpl) => ({
    planner: T.plannerPrompt(tk, av, stPlan, 'prior diag'),
    implementer: T.implementerPrompt(tk, av, stImpl, 'prior diag'),
    approvedPlan: T.approvedPlanImplementerPrompt(tk, 'PLAN', av, stImpl, 'prior diag'),
    readOnly: T.readOnlyPrompt(tk, av, stImpl, 'prior diag'),
  })
  const top = builders(ST_TOP, ST_TOP)
  ok(Object.values(top).every((p) => p.includes('SECOND PASS') && p.includes("the ladder's top rung") && !p.includes('ONE RUNG UP')), 'framing: on the top rung NO builder promises a takeover — every one renders the second pass')
  const up = builders(ST_PLAN_CLIMBED, ST_CLIMBED)
  ok(Object.values(up).every((p) => p.includes('ONE RUNG UP') && !p.includes('SECOND PASS')), 'framing: after its stage\'s real climb every builder renders the takeover')
  ok(T.plannerPrompt(tk, av, ST_CLIMBED, 'prior diag').includes('SECOND PASS'), 'framing: the planner reads the PLAN climb, never the implement one')
  ok(!T.escalationContext('diag', ST_CLIMBED, 'plan').includes('ONE RUNG UP') && T.escalationContext('diag', ST_CLIMBED, 'implement').includes('ONE RUNG UP'), 'framing: escalationContext keys off the stage it is given')
  ok(T.escalationContext('', ST_TOP, 'implement') === '', 'framing: no prior ⇒ still empty (byte-identical)')
  const ro = T.escalationContext('diag', ST_TOP, 'implement', 'readonly')
  ok(ro.includes('SECOND PASS') && !ro.includes('FULL verification loop') && !ro.includes('on your branch'), 'framing: the read-only second pass keeps its read-only contract')
  // The planner and the investigator write no code: in BOTH arms (the top rung's second pass, the takeover
  // after a real climb) their framing restates the no-edit contract and never names a verification loop or
  // a branch. Checked on the rendered builders, so a call site passing the wrong kind fails here too.
  const noCode = (p) => !p.includes('FULL verification loop') && !p.includes('on your branch') && p.includes('no source edits, no commits, no PR')
  const readers = (b) => ({ planner: b.planner, readOnly: b.readOnly })
  ok(Object.values(readers(top)).every(noCode), 'framing: the planner and the investigator second pass (top rung) carry no verification-loop or branch wording, and keep the no-edit contract')
  ok(Object.values(readers(up)).every(noCode), 'framing: the planner and the investigator takeover (after a real climb) carry no verification-loop or branch wording, and keep the no-edit contract')
  ok(up.planner.includes('ONE RUNG UP') && up.planner.includes('plan-only contract') && top.planner.includes('plan-only contract'), 'framing: the planner\'s arms ask for a plan')
  ok(up.readOnly.includes('ONE RUNG UP') && up.readOnly.includes('read-only contract') && top.readOnly.includes('read-only contract'), 'framing: the investigator\'s arms keep the read-only contract')
  const coders = { implementer: up.implementer, approvedPlan: up.approvedPlan, implementerTop: top.implementer, approvedPlanTop: top.approvedPlan }
  ok(Object.values(coders).every((p) => p.includes('on your branch')), 'framing: the code-writing roles keep the committed-work-on-your-branch wording in both arms')
  ok(top.implementer.includes('FULL verification loop') && top.approvedPlan.includes('FULL verification loop'), 'framing: the code-writing second pass runs the FULL verification loop')
}
// A rung: the ladder lacks is read as the top rung — prototype keys included, never an inherited answer.
for (const bad of ['gone', 'constructor', 'toString', '__proto__']) {
  const st = stOf({ rung: bad }, {})
  ok(T.onTop(st) && st.drift === bad && T.verifyBlock(st, 'make test', 3, []) === T.ralphLoop('make test', 3, []), `drift: rung ${bad} reads as the top rung, full loop, reported as drift`)
}

// ---- Top-rung scenarios: the same rung retries at CAPPED_RETRY_ITERATIONS -----------------------------
// Scenario E — a plan-gated task STARTING on the top rung (`rung: opus-xhigh`), failing its first pass in BOTH
// layers. Its first implement pass already ran the full loop, so the retry gets the reduced constant.
effortCalls.length = 0
ctx.agent = recordingAgent(async (prompt, opts) => {
  if (opts.label.startsWith('plan-judge:')) return { verdict: 'approve', feedback: [] }
  if (opts.label.startsWith('plan:')) {
    return opts.label.endsWith('@opus-xhigh')
      ? { ready: true, blocked: false, blockerCause: '', plan: 'PLAN\n### Gated inputs\nNone' }
      : { ready: false, blocked: false, blockerCause: 'first planner produced no plan', plan: '' }
  }
  if (opts.phase === 'Implement') {
    // A top-rung first pass renders ralphLoop, and ralphLoop never instructs escalate=true — its step (d)
    // says blocked=true, verified=false. Only oneShotVerify asks for escalate, so the retry is reached
    // through the arm a compliant agent can actually take.
    return opts.label.endsWith('@opus-xhigh')
      ? greenImpl
      : { verified: false, blocked: true, escalate: false, prUrl: '', branch: 'b', worktreePath: '/wt', blockerDiagnosis: 'red first pass', summary: '' }
  }
  return { verdict: 'approve', feedback: [] } // master review
})
const topRes = await T.converge({ ...baseEff, slug: 'proj-eff-e', scope: 'cross-cutting', planGate: true, rung: 'opus-xhigh', maxIterations: 4 }, aEff)
ok(effortCalls.length > 0 && effortCalls.every((c) => c.model === 'opus'), 'top E: every dispatch runs on the top rung\'s model')
ok(topRes && topRes.status === 'review' && topRes.startRung === 'opus-xhigh' && topRes.rung === 'opus-xhigh', 'top E: a top-rung task still converges')
ok(topRes && JSON.stringify(topRes.climbs) === JSON.stringify(['plan', 'implement'].map((stage) => ({ stage, from: 'opus-xhigh', to: 'opus-xhigh' }))), 'top E: both stages\' climbs are recorded no-ops, in order')
const topSecond = effortCalls.filter((c) => c.label.endsWith('@opus-xhigh'))
ok(topSecond.length === 2, 'top E: both layers ran a same-rung second pass (plan + implement)')
ok(topSecond.every((c) => c.prompt.includes('SECOND PASS') && !c.prompt.includes('ONE RUNG UP')), 'top E: no second-pass prompt claims a takeover')
ok(call('plan:proj-eff-e').effort === 'xhigh' && callAt('plan:proj-eff-e@opus-xhigh').effort === 'xhigh' && call('implement:proj-eff-e').effort === 'xhigh', 'top E: the code-writing roles run at the top rung\'s effort, retries included')
ok(callAt('review:proj-eff-e r1') && callAt('review:proj-eff-e r1').effort === 'xhigh', 'top E: master review runs at the top rung\'s review effort')
const topFirst = call('implement:proj-eff-e')
const topRetry = callAt('implement:proj-eff-e@opus-xhigh')
ok(topFirst && topFirst.prompt.includes('Max iterations: 4') && !topFirst.prompt.includes('EXACTLY ONCE'), 'top E: the top rung\'s first pass is the full Ralph loop, never the one-shot')
ok(topRetry && topRetry.prompt.includes('Max iterations: 2'), 'top E: the same-rung retry runs a REDUCED budget (4 ⇒ 2), never a second full one')

// Scenario F — the TEMPLATE DEFAULT shape on the top rung: scope single-file, so plan_approval: scope-gated
// leaves planGate false, and max_iterations is the template's 3. With no plan layer nothing climbs before the
// first implement dispatch. It also pins the retry budget floor: floor(3/2) is 1, and a 1-iteration
// ralphLoop blocks without ever re-running the verifier.
effortCalls.length = 0
ctx.agent = recordingAgent(async (prompt, opts) => {
  if (opts.phase === 'Implement') {
    return opts.label.endsWith('@opus-xhigh')
      ? greenImpl
      : { verified: false, blocked: true, escalate: false, prUrl: '', branch: 'b', worktreePath: '/wt', blockerDiagnosis: 'red first pass', summary: '' }
  }
  return { verdict: 'approve', feedback: [] }
})
const topDef = await T.converge({ ...baseEff, slug: 'proj-eff-f', scope: 'single-file', planGate: false, rung: 'opus-xhigh', maxIterations: 3 }, aEff)
ok(topDef && JSON.stringify(topDef.climbs) === JSON.stringify([{ stage: 'implement', from: 'opus-xhigh', to: 'opus-xhigh' }]), 'top F: with no plan layer the first climb is the IMPLEMENT stage\'s, a recorded no-op')
ok(call('implement:proj-eff-f') && call('implement:proj-eff-f').effort === 'xhigh', 'top F: the first pass of a non-plan-gated top-rung task runs at the top rung\'s effort')
const defFirst = call('implement:proj-eff-f')
const defRetry = callAt('implement:proj-eff-f@opus-xhigh')
ok(defFirst && defFirst.prompt.includes('Max iterations: 3') && !defFirst.prompt.includes('EXACTLY ONCE'), 'top F: the first pass spends the FULL template budget on the Ralph loop')
ok(defRetry && defRetry.prompt.includes('Max iterations: 2'), 'top F: the retry gets the fixed one-cycle constant, not a function of max_iterations')
ok(effortCalls.length > 0 && effortCalls.every((c) => c.model === 'opus'), 'top F: every dispatch of the non-plan-gated path stays on the ladder')
// n differs between E (4) and F (3) and both retries are 2 — that is what pins the budget as a CONSTANT
// rather than an arithmetic function that happens to land on 2 at one value of n.
ok(T.CAPPED_RETRY_ITERATIONS === 2 && topRetry && topRetry.prompt.includes('Max iterations: 2') && defRetry.prompt.includes('Max iterations: 2'), 'top E+F: the retry budget is independent of max_iterations (4 and 3 both ⇒ 2)')

// Scenario G — the budget edge BOTH earlier arithmetic attempts got wrong, pinned at a value where a constant
// and a halving visibly disagree. floor(n/2) and min(n, max(2, floor(n/2))) both return 2 at n=3 and n=4, so
// Scenarios E and F cannot tell an arithmetic function from a constant; at n=8 the halving returns 4 and the
// constant still returns 2. Without this, reverting to either arithmetic form ships green — and each of those
// forms shipped a real defect (1 iteration at the template default; a full second budget at n=2).
effortCalls.length = 0
ctx.agent = recordingAgent(async (prompt, opts) => {
  if (opts.phase === 'Implement') {
    return opts.label.endsWith('@opus-xhigh')
      ? greenImpl
      : { verified: false, blocked: true, escalate: false, prUrl: '', branch: 'b', worktreePath: '/wt', blockerDiagnosis: 'red', summary: '' }
  }
  return { verdict: 'approve', feedback: [] }
})
await T.converge({ ...baseEff, slug: 'proj-eff-g', scope: 'single-file', planGate: false, rung: 'opus-xhigh', maxIterations: 8 }, aEff)
const gFirst = call('implement:proj-eff-g')
const gRetry = callAt('implement:proj-eff-g@opus-xhigh')
ok(gFirst && gFirst.prompt.includes('Max iterations: 8'), 'top G: the first pass still spends the full task budget')
ok(gRetry && gRetry.prompt.includes('Max iterations: 2'), 'top G: the retry is a CONSTANT one cycle at n=8 — not half (4), not a second full budget')

// ---- Gated inputs (ADR 0008): a declared gate always pauses for a human -------
// The plan carries a REQUIRED "### Gated inputs" section (spend with a hard cap / credentials /
// irreversible actions, or exactly "None"). A non-empty declaration not covered by the task note's
// approved gates returns the task at status 'gate-pending' — regardless of plan_approval config or
// continuous mode — and NEVER escalates (a gate stop is a human decision, not evidence of hardness).
// Approved gates (task.approvedGates, read from the note's "## Approved gates") skip the stop for
// exactly those gates, so re-dispatches never re-ask.

// The requirement is ALWAYS rendered — in the planner, the plan-reviser, the plan-judge's checklist,
// and every code-writing prompt's stop rule (the plan_approval:false path).
const plPrompt = T.plannerPrompt(taskI, aI, ST_BOTTOM, '')
ok(plPrompt.includes('### Gated inputs'), 'plannerPrompt: always renders the Gated inputs requirement')
ok(/hard cap/i.test(plPrompt), 'plannerPrompt: spend gates require a hard cap')
const prvPrompt = T.planReviserPrompt(taskI, 'PLAN', [{ round: 1, feedback: ['x'] }], 2, aI)
ok(prvPrompt.includes('Gated inputs'), 'planReviserPrompt: required sub-sections include Gated inputs')
const pjPrompt = T.planJudgePrompt(taskI, 'PLAN', aI)
ok(pjPrompt.includes('Gated inputs') && /automatic "changes"/.test(pjPrompt), 'planJudgePrompt: missing Gated inputs section is an automatic changes')
ok(plPrompt.includes('BULLETS ONLY'), 'plannerPrompt: gated-inputs section forbids non-bullet prose')
ok(/non-bullet prose/.test(pjPrompt), 'planJudgePrompt: prose in the gated-inputs section is an automatic changes')
ok(/bullets only/i.test(prvPrompt), 'planReviserPrompt: revision keeps the bullets-only rule')
ok(pBottom.includes('Gated inputs (hard rule'), 'implementerPrompt: carries the gated-inputs stop rule')
ok(T.approvedPlanImplementerPrompt(taskI, 'PLAN', aI, ST_CLIMBED, '').includes('Gated inputs (hard rule'), 'approvedPlanImplementerPrompt: carries the stop rule')
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
ok(gPlan.climbs.length === 0, 'gate A: a gate stop never climbs')

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
ok(gImpl.climbs.length === 0 && gImpl.rung === 'opus-high', 'gate C: a gate stop on the bottom first pass does not climb')
ok(!effortCalls.some((c) => c.label.startsWith('implement:proj-gate-c@')), 'gate C: no takeover on a gate stop')

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

// ---- Round budgets fail closed (p12-2) ----------------------------------------
// planLoop / reviewLoop are bounded `while (round <= budget)` loops whose only returns sit inside the
// body. A budget of 0, a negative, NaN, undefined/null (an omitted or empty YAML key), a fraction or a
// numeric string used to fall off the end and return undefined. For planLoop that is a fail-OPEN on
// ADR 0008: implement() read `prev === undefined` as "no gate", so the task was implemented with no plan,
// no judge and no gated-inputs parse. Every one of those values must now block, before any dispatch.
{
  const BAD = [0, NaN, undefined, null, -1, 2.5, '2', Infinity]
  const show = (v) => (typeof v === 'string' ? `'${v}'` : String(v))
  const spendPlan = 'PLAN\n### Gated inputs\n- spend: x — cap $5'
  const approveAll = recordingAgent(async (prompt, opts) => {
    if (opts.label.startsWith('plan-judge:')) return { verdict: 'approve', feedback: [] }
    if (opts.label.startsWith('plan:')) return { ready: true, blocked: false, blockerCause: '', plan: spendPlan }
    if (opts.phase === 'Implement') return greenImpl
    return { verdict: 'approve', feedback: [] }
  })
  const dispatched = () => effortCalls.map((c) => c.label)

  // The helper: integer >= 1 or a diagnosis naming the field and the bad value, quote-free (the lead
  // copies it into a ROLLOUT-STATUS reason, and the Stop-hook regex needs quote-free reasons).
  ok(T.roundBudgetDiagnosis({ maxPlanRounds: 1, maxReviewRounds: 6 }, ['maxPlanRounds', 'maxReviewRounds']) === '',
    'round budgets: valid integers >= 1 (incl. a large 6) produce no diagnosis')
  for (const v of BAD) {
    const d = T.roundBudgetDiagnosis({ maxPlanRounds: v }, ['maxPlanRounds'])
    ok(/max_plan_rounds/.test(d) && d.includes(show(v)) && !d.includes('"'),
      `round budgets: maxPlanRounds=${show(v)} → quote-free diagnosis naming the field and value`)
  }
  ok(!T.roundBudgetDiagnosis({ maxReviewRounds: 'a"b' }, ['maxReviewRounds']).includes('"'),
    'round budgets: a double quote inside a string value never reaches the diagnosis')

  // 1. The ADR 0008 fail-open: a plan-gated task whose plan WOULD declare a spend gate. Each bad plan
  //    budget must stop at plan-blocked with ZERO dispatches (no planner, no implementer, no review).
  for (const v of BAD) {
    effortCalls.length = 0
    ctx.agent = approveAll
    const r = await T.converge({ ...baseEff, slug: 'proj-rb-plan', scope: 'cross-cutting', planGate: true, maxPlanRounds: v }, aEff)
    ok(r && r.status === 'plan-blocked' && r.blocked === true && /max_plan_rounds/.test(r.blockerDiagnosis),
      `round budgets: plan-gated maxPlanRounds=${show(v)} → plan-blocked naming max_plan_rounds (was ${r && r.status})`)
    ok(effortCalls.length === 0, `round budgets: plan-gated maxPlanRounds=${show(v)} → zero dispatches (got ${dispatched().join(', ')})`)
  }

  // 2. planLoop called directly never returns undefined.
  {
    effortCalls.length = 0
    ctx.agent = approveAll
    const st = T.rungState({ slug: 'proj-rb-pl' }, aEff)
    const r = await T.planLoop({ ...baseEff, slug: 'proj-rb-pl', scope: 'cross-cutting', planGate: true, maxPlanRounds: 0 }, st, aEff)
    ok(r !== undefined && r.status === 'plan-blocked' && r.planRoundsUsed === 0, 'round budgets: planLoop(maxPlanRounds=0) returns a defined plan-blocked result, planRoundsUsed 0')
    ok(effortCalls.length === 0, 'round budgets: planLoop(maxPlanRounds=0) dispatches nothing')
  }

  // 3. A bad review budget: converge's pre-flight blocks BEFORE any implementer/PR is spent. The
  //    diagnosis rides reviewFeedback too — reconcile writes bullets(reviewFeedback) for review-blocked
  //    when reviewHistory is empty.
  for (const v of BAD) {
    effortCalls.length = 0
    ctx.agent = approveAll
    const r = await T.converge({ ...baseEff, slug: 'proj-rb-rev', scope: 'single-file', planGate: false, maxReviewRounds: v }, aEff)
    ok(r && r.status === 'review-blocked' && /max_review_rounds/.test(r.blockerDiagnosis)
      && Array.isArray(r.reviewFeedback) && /max_review_rounds/.test(r.reviewFeedback[0] || '')
      && Array.isArray(r.reviewHistory) && r.reviewHistory.length === 0 && r.reviewRoundsUsed === 0,
      `round budgets: maxReviewRounds=${show(v)} → review-blocked, diagnosis in blockerDiagnosis + reviewFeedback (was ${r && r.status})`)
    ok(effortCalls.length === 0, `round budgets: maxReviewRounds=${show(v)} → zero dispatches, no implementer or PR spent (got ${dispatched().join(', ')})`)
  }
  {
    effortCalls.length = 0
    ctx.agent = approveAll
    const r = await T.converge({ ...baseEff, slug: 'proj-rb-both', scope: 'cross-cutting', planGate: true, maxReviewRounds: 0 }, aEff)
    ok(r && r.status === 'review-blocked' && effortCalls.length === 0, 'round budgets: plan-gated task with a bad review budget → review-blocked, no plan: dispatch either')
    ok(r && r.startRung === 'opus-high' && r.rung === 'opus-high' && r.climbs.length === 0 && r.ran.length === 0 && r.rungDrift === '', 'round budgets: the pre-flight result carries the normal rung record — its starting rung, no climb, nothing ran')
    effortCalls.length = 0
    const both = await T.converge({ ...baseEff, slug: 'proj-rb-both', scope: 'cross-cutting', planGate: true, maxReviewRounds: 0, maxPlanRounds: NaN }, aEff)
    ok(both && both.status === 'review-blocked' && /max_review_rounds/.test(both.blockerDiagnosis) && /max_plan_rounds/.test(both.blockerDiagnosis),
      'round budgets: both budgets bad → one diagnosis names every invalid field, so one fix pass covers both')
  }

  // 4. reviewLoop called directly with a green PR and a 0 budget never returns undefined.
  {
    effortCalls.length = 0
    ctx.agent = approveAll
    const st = T.rungState({ slug: 'proj-rb-rl' }, aEff)
    const r = await T.reviewLoop({ ...baseEff, slug: 'proj-rb-rl', scope: 'single-file', maxReviewRounds: 0 }, st, greenImpl, aEff, '')
    ok(r !== undefined && r.status === 'review-blocked' && r.reviewRoundsUsed === 0 && r.prUrl === greenImpl.prUrl && /max_review_rounds/.test(r.reviewFeedback[0] || ''),
      'round budgets: reviewLoop(maxReviewRounds=0) returns review-blocked (PR preserved), not undefined')
    ok(effortCalls.length === 0, 'round budgets: reviewLoop(maxReviewRounds=0) dispatches no judge')
  }

  // 5. Non-regression controls.
  {
    effortCalls.length = 0
    ctx.agent = recordingAgent(async (prompt, opts) => {
      if (opts.label.startsWith('plan-judge:')) return { verdict: 'approve', feedback: [] }
      if (opts.label.startsWith('plan:')) return { ready: true, blocked: false, blockerCause: '', plan: 'PLAN\n### Gated inputs\nNone' }
      if (opts.phase === 'Implement') return greenImpl
      return { verdict: 'approve', feedback: [] }
    })
    const min = await T.converge({ ...baseEff, slug: 'proj-rb-min', scope: 'cross-cutting', planGate: true, maxPlanRounds: 1, maxReviewRounds: 1 }, aEff)
    ok(min && min.status === 'review' && min.planRoundsUsed === 1, 'round budgets: the valid minimum (1) still converges to review')

    effortCalls.length = 0
    ctx.agent = recordingAgent(async () => greenImpl)
    const ro = await T.converge({ ...baseEff, slug: 'proj-rb-ro', scope: 'read-only', planGate: false, maxReviewRounds: 0 }, aEff)
    ok(ro && ro.status === 'review' && ro.reviewRoundsUsed === 0, 'round budgets: read-only task ignores its review budget (no review layer runs)')

    effortCalls.length = 0
    ctx.agent = approveAll
    const np = await T.converge({ ...baseEff, slug: 'proj-rb-np', scope: 'single-file', planGate: false, maxPlanRounds: 0 }, aEff)
    ok(np && np.status === 'review', 'round budgets: a non-plan-gated task is not blocked by a plan budget the engine never uses')
  }

  // 6. The upstream refusal: SKILL.md § 3 validates all three budgets before any stamp or dispatch,
  //    and § 7 names the halt.
  const skill = fs.readFileSync(path.join(here, '..', 'SKILL.md'), 'utf8')
  const sect = (from, to) => { const i = skill.indexOf(from); const j = skill.indexOf(to, i + 1); return i === -1 || j === -1 ? '' : skill.slice(i, j) }
  const s3 = sect('### 3. Resolve effective config per task', '### 3.5.')
  const rule = s3.split('\n\n').find((p) => p.includes('integer >= 1')) || ''
  ok(['max_iterations', 'max_review_rounds', 'max_plan_rounds'].every((f) => rule.includes(f)),
    'SKILL.md § 3: one "integer >= 1" rule covers max_iterations, max_review_rounds and max_plan_rounds')
  ok(/in_progress/.test(rule) && /mark-started/.test(rule) && rule.includes('reason="invalid round budget:'),
    'SKILL.md § 3: the rule writes nothing (no stamp, no mark-started) and halts with the named reason')
  ok(sect('### 7. Continuous-mode stop conditions', '### 8.').includes('reason="invalid round budget:'),
    'SKILL.md § 7: the stop-conditions list carries the invalid-round-budget halt')
}

// ---- Pinned task tree (ADR 0030, p12-4): CLASS closer through converge() ----------
// Every read-only agent (planner, plan judge, plan reviser, investigator, review judge) is handed the
// task's own tree, never `Project root: <repoPath>` — checked on the prompts converge() actually
// dispatches, so a builder or call site that slips back to the shared checkout fails here. repoPath is a
// sentinel, so any bare read of it shows. Implementer prompts keep `Project root:` (byte-frozen).
{
  const aTree = { repoPath: '/REPOROOT', rolloutSlug: 'proj-rollout', verifier: 'make test' }
  const seen = {}
  effortCalls.length = 0
  ctx.agent = recordingAgent(async (prompt, opts) => {
    const k = opts.label.replace(/ r\d+$/, '')
    seen[k] = (seen[k] || 0) + 1
    if (opts.label.startsWith('plan-judge:')) return seen[k] === 1 ? { verdict: 'changes', feedback: ['tighten it'] } : { verdict: 'approve', feedback: [] }
    if (opts.label.startsWith('plan:') || opts.label.startsWith('plan-revise:')) return { ready: true, blocked: false, blockerCause: '', plan: 'Planned on: abc\nPLAN\n### Gated inputs\nNone' }
    if (opts.label.startsWith('review:')) return seen[k] === 1 ? { verdict: 'changes', feedback: ['fix it'] } : { verdict: 'approve', feedback: [] }
    return greenImpl // implement: / investigate: / revise:
  })
  const tasks = [
    { ...baseEff, slug: 'proj-tree-code', scope: 'cross-cutting', planGate: true },
    { ...baseEff, slug: 'proj-tree-ro-gated', scope: 'read-only', planGate: true },
    { ...baseEff, slug: 'proj-tree-ro', scope: 'read-only', planGate: false },
  ]
  const res = []
  for (const t of tasks) res.push(await T.converge(t, aTree))
  ok(res.every((r) => r && r.status === 'review'), 'pinned tree: all three tasks converge to review')
  const by = (prefix) => effortCalls.filter((c) => c.label.startsWith(prefix))
  const treeOf = (label) => `Task tree: /REPOROOT/.claude/worktrees/${label.split(':')[1].split(/[ @]/)[0]}`
  const readers = [...by('plan:'), ...by('plan-judge:'), ...by('plan-revise:'), ...by('investigate:'), ...by('review:')]
  for (const want of ['plan:proj-tree-code', 'plan-judge:proj-tree-code', 'plan-revise:proj-tree-code', 'review:proj-tree-code',
    'plan:proj-tree-ro-gated', 'plan-judge:proj-tree-ro-gated', 'plan-revise:proj-tree-ro-gated', 'investigate:proj-tree-ro-gated',
    'investigate:proj-tree-ro']) {
    ok(readers.some((c) => c.label.startsWith(want)), `pinned tree: converge dispatched ${want}`)
  }
  ok(readers.length >= 11 && readers.every((c) => c.prompt.includes(treeOf(c.label)) && !c.prompt.includes('Project root: /REPOROOT')),
    'pinned tree: every plan / plan-judge / plan-revise / investigate / review prompt carries its Task tree:, never Project root:')
  const roFirst = effortCalls.filter((c) => ['plan:proj-tree-ro-gated', 'investigate:proj-tree-ro-gated', 'investigate:proj-tree-ro'].includes(c.label))
  ok(roFirst.length === 3 && roFirst.every((c) => c.prompt.includes('worktree add --detach "$WT"') && !c.prompt.includes('-b "$BR"')),
    'pinned tree: the read-only tasks\' plan: and investigate: prompts create a detached tree')
  ok(by('plan:proj-tree-code')[0].prompt.includes('worktree add "$WT" -b "$BR"'), 'pinned tree: the code-writing planner creates the branch tree')
  ok(by('implement:').length === 1 && by('implement:')[0].prompt.includes('Project root: /REPOROOT') && !by('implement:')[0].prompt.includes('Task tree:'),
    'pinned tree: the implementer keeps Project root: (byte-frozen builder)')
  ok(by('revise:').length === 1 && !by('revise:')[0].prompt.includes('Task tree:') && by('revise:')[0].prompt.includes('Worktree path: /wt'),
    'pinned tree: the reviser keeps its threaded Worktree path (byte-frozen builder)')
}

// ---- Progress / ETA (task-note stamps — the engine has no clock) ------
// The Workflow sandbox cannot read clocks (Date.now() throws), so the started:/merged: stamps live on the
// TASK NOTES, written by reconcile-rollout.py (mark-started as a task starts, mark-done after its merge),
// and the skill threads the precomputed `progress` line `next` / `mark-started` prints into args for the
// engine to relay via log(). Comments may
// NAME Date.now(); code must never CALL it — strip line comments before scanning.
const codeOnly = src.replace(/\/\/[^\n]*/g, '')
ok(!/\bDate\s*\.\s*now\b|\bnew\s+Date\b/.test(codeOnly), 'engine: no clock reads — Date is unavailable in the Workflow sandbox')
ok(src.includes('if (a.progress) log(a.progress)'), 'engine: relays the precomputed progress line (absent ⇒ byte-identical logs)')

// ---- Removing files (p12-12, the 2026-10-01 stall): RM_RULE in every agent prompt ----------
// An agent's `cd /tmp/x && rm -rf ./*` stalled an unattended rollout 13 h on Claude Code's bypass-immune
// removal ask. RM_RULE names the safe forms, and every builder renders it once, right after GIT_ENV_RULE.
// The ten builders are git-env-scrub's (its (e2) proves every runAgent site is one of them).
{
  const E = loadEngine(['GIT_ENV_RULE', 'RM_RULE', 'rungState', 'escalate', 'implementerPrompt', 'approvedPlanImplementerPrompt', 'reviserPrompt', 'readOnlyPrompt',
    'plannerPrompt', 'planReviserPrompt', 'planJudgePrompt', 'reviewJudgePrompt', 'integratorPrompt', 'integrationReviewPrompt'])
  const H = (c) => c.repeat(40)
  const tk = { slug: 'proj-fix-x', taskPath: '/vault/proj-fix-x.md', maxIterations: 3, scope: 'cross-cutting' }
  const im = { prUrl: 'https://github.com/o/r/pull/1', worktreePath: '/repo/.claude/worktrees/proj-fix-x', branch: 'audit-fix/fix-x' }
  const ar = { repoPath: '/repo', verifier: 'make test', rolloutSlug: 'r' }
  const I = {
    prUrl: im.prUrl, branch: im.branch, worktreePath: im.worktreePath, headSha: H('a'), taskBase: H('b'), mainSha: H('c'), trouble: ['conflict'],
    landed: [{ prUrl: 'https://github.com/o/r/pull/2', title: 't', files: ['a.js'], taskPath: '/vault/t.md' }], plan: 'PLAN',
    reviewHistory: [{ round: 1, feedback: ['fix it'] }, { round: 2, feedback: ['keep theirs'], stage: 'integration' }], reviewRoundsUsed: 2,
    rung: { startRung: 'opus-high', rung: 'opus-xhigh', climbs: [{ stage: 'implement', from: 'opus-high', to: 'opus-xhigh' }] },
  }
  const J = { mergeCommit: H('d'), headSha: H('e'), baseSha: H('c'), triggers: ['conflict'], path: 'integrator' }
  // The implementers on the bottom rung (one-shot) and after a climb (the full loop).
  const climbed = E.rungState(tk, ar)
  E.escalate(climbed, tk.slug, 'implement')
  const states = [E.rungState(tk, ar), climbed]
  const prompts = {
    implementerPrompt: states.map((st) => E.implementerPrompt(tk, ar, st, '')),
    approvedPlanImplementerPrompt: states.map((st) => E.approvedPlanImplementerPrompt(tk, 'PLAN', ar, st, '')),
    reviserPrompt: [E.reviserPrompt(tk, im, [{ round: 1, feedback: ['fix it'] }], 2, ar, ''), E.reviserPrompt(tk, im, I.reviewHistory, 3, ar, '', { history: I.reviewHistory, roundsUsed: 2 })],
    readOnlyPrompt: [E.readOnlyPrompt(tk, ar, states[0], '')],
    plannerPrompt: [E.plannerPrompt(tk, ar, states[0], '')],
    planReviserPrompt: [E.planReviserPrompt(tk, 'PLAN', [{ round: 1, feedback: ['fix it'] }], 2, ar)],
    planJudgePrompt: [E.planJudgePrompt(tk, 'PLAN', ar)],
    reviewJudgePrompt: [E.reviewJudgePrompt(tk, im, ar, [])],
    integratorPrompt: [E.integratorPrompt(tk, ar, I), E.integratorPrompt(tk, ar, { ...I, landed: [], reviewHistory: [], trouble: [] })],
    integrationReviewPrompt: [E.integrationReviewPrompt(tk, ar, I, J), E.integrationReviewPrompt(tk, ar, { ...I, landed: [] }, { ...J, mergeCommit: '', path: 'judge-only' })],
  }
  const FORMS = ['`rm -rf /tmp/x && mkdir -p /tmp/x`', '`mktemp -d`', '`rm -rf "$T"`', '${T:?}', '`rm -rf ./*`', '`$VAR/`', 'command substitution', 'bypass mode']
  const times = (hay, needle) => hay.split(needle).length - 1
  // [] when the rule and every prompt hold; else what failed.
  const rmRuleFails = (rule, gitRule, byName) => {
    const out = []
    if (typeof rule !== 'string' || !rule || rule.includes('\n')) out.push('rule: one line')
    for (const f of FORMS) if (!String(rule).includes(f)) out.push(`rule: names ${f}`)
    if (String(rule).includes('"$T"/')) out.push('rule: the "$T" form takes no trailing slash')
    for (const [name, ps] of Object.entries(byName)) {
      for (const p of ps) {
        if (times(p, rule) !== 1) out.push(`${name}: RM_RULE once`)
        if (!p.includes(gitRule + '\n\n' + rule)) out.push(`${name}: RM_RULE right after GIT_ENV_RULE`)
      }
    }
    return out
  }
  ok(Object.keys(prompts).length === 10, 'RM_RULE: the ten agent builders are covered')
  ok(JSON.stringify(rmRuleFails(E.RM_RULE, E.GIT_ENV_RULE, prompts)) === '[]', 'RM_RULE: one line naming every safe and refused form, once in every prompt, right after GIT_ENV_RULE')
  const stripped = { ...prompts, plannerPrompt: prompts.plannerPrompt.map((p) => p.replace('\n\n' + E.RM_RULE, '')) }
  ok(rmRuleFails(E.RM_RULE, E.GIT_ENV_RULE, stripped).length > 0, 'RM_RULE control: a prompt with RM_RULE stripped fails')
  const slashed = E.RM_RULE.replace('`rm -rf "$T"`', '`rm -rf "$T"/*`')
  const reslashed = Object.fromEntries(Object.entries(prompts).map(([k, ps]) => [k, ps.map((p) => p.replace(E.RM_RULE, slashed))]))
  ok(slashed !== E.RM_RULE && rmRuleFails(slashed, E.GIT_ENV_RULE, reslashed).length > 0, 'RM_RULE control: a "$T" form that gains /* fails')
}

// ---- Byte pins (p12-6): task mode renders exactly what it did before Integration existed ----------
// Recorded on 3c396eb (the p12-5 engine) BEFORE the p12-6 edit. p12-6 factored taskTreeSetup's self-heal
// and lock lines out (treeSelfHeal/treeLockLines, shared with branchTreeSetup), gave reviserPrompt a 7th
// `seeded` argument and moved the review loop's revise step into reviseRound: none of that may move a byte
// of an unseeded, mode-less call. Re-pin only on a deliberate prompt change, never to make a refactor pass.
// Re-pinned on purpose by p12-12 (the reviser pins and the whole-call pin): RM_RULE joins every agent prompt
// right after GIT_ENV_RULE, and the implementer's worktree setup now says "every task that has already
// merged". An old-vs-new render diff showed exactly those two changes; the taskTreeSetup pin did not move.
// Split by p13-2 (the ladder): the whole-call pin is a CALLS hash (every label and prompt) and a ROWS hash.
// The calls hash was recorded on the p13-1 engine (e3da213) with this fixture — `rung:` and `ladder` added,
// which that engine ignores, and the tier ceiling dropped, which changed nothing there — and the ladder
// engine renders it byte-identically: the rung work moved no label and no prompt of these calls. Only the
// rows hash was re-pinned, for the row's rung record (startRung, rung, climbs, rungDrift, ran).
{
  const sha = (x) => crypto.createHash('sha256').update(x).digest('hex')
  const variants = []
  for (const scope of ['cross-cutting', 'read-only']) for (const refresh of [true, false]) {
    for (const envBootstrap of [undefined, 'poetry install']) for (const defaultBranch of [undefined, 'master']) {
      const a = { repoPath: '/repo', ...(envBootstrap ? { envBootstrap } : {}), ...(defaultBranch ? { defaultBranch } : {}) }
      variants.push(T.taskTreeSetup(a, { slug: 'proj-fix-x', scope }, refresh))
    }
  }
  ok(variants.length === 16 && sha(variants.join('\n\0\n')) === '9ebeb0bde77b5741b7461f56cc3abe12e3ead5f12a4f5bb3c5cd1f56e66557f5',
    'byte pin: taskTreeSetup, 16 variants (scope × refresh × envBootstrap × defaultBranch)')
  const tR = { slug: 'proj-fix-x', taskPath: '/vault/proj-fix-x.md', maxIterations: 3, scope: 'cross-cutting' }
  const iR = { prUrl: 'https://github.com/o/r/pull/1', worktreePath: '/repo/.claude/worktrees/proj-fix-x', branch: 'audit-fix/fix-x' }
  const aR = { repoPath: '/repo', verifier: 'make test', rolloutSlug: 'r' }
  const h2 = [{ round: 1, feedback: ['a'] }, { round: 2, feedback: ['b'] }]
  ok(sha(T.reviserPrompt(tR, iR, h2.slice(0, 1), 2, aR, '')) === '0f7eca821281f140a718ea5bf84cec5c0a134a7924e8b2ff9d3abfe5ea9db585',
    'byte pin: unseeded reviserPrompt, round 2')
  ok(sha(T.reviserPrompt(tR, iR, h2, 3, aR, 'PLAN')) === '00eb424a53642e113f76ea70fc78644762f75c0a40d2edcee36429f760fed660',
    'byte pin: unseeded reviserPrompt, round 3 with the plan (step-back)')
  ok(T.reviserPrompt(tR, iR, h2, 3, aR, 'PLAN', null) === T.reviserPrompt(tR, iR, h2, 3, aR, 'PLAN'),
    'byte pin: a null seeded argument renders the unseeded reviser')
  // Every label, prompt and row of three whole task-mode calls (a plan-gated bottom-rung task with a plan
  // revise and two review rounds; a top-rung task on master with env bootstrap and a baseline; a plan-gated
  // read-only task on the top rung). Each task keeps the legacy `model:` that gave the p13-1 engine the same
  // call shape; `rung:` wins over it here.
  const PLAN_TEXT = 'Planned on: abc\n### Files to modify\n- x\n### Gated inputs\nNone'
  const LADDER = { source: 'built-in', rungs: [
    { name: 'opus-high', model: 'opus', effort: 'high', judge: 'high', review: 'xhigh' },
    { name: 'opus-xhigh', model: 'opus', effort: 'xhigh', judge: 'high', review: 'xhigh' },
  ] }
  const mkT = (slug, over = {}) => ({ slug, taskPath: `/vault/Tasks/${slug}.md`, scope: 'cross-cutting', planGate: false, maxIterations: 3, maxReviewRounds: 3, maxPlanRounds: 3, model: 'fable', rung: 'opus-xhigh', ...over })
  const mkA = (task, over = {}) => ({ rolloutSlug: 'proj-rollout-2026-10-01', repoPath: '/repo', verifier: 'make test', date: '2026-10-01', ladder: LADDER, task, ...over })
  const scripted = async (prompt, opts) => {
    const label = opts.label
    const kind = label.split(':')[0]
    const s = label.split(':')[1].split(/[ @]/)[0]
    if (kind === 'plan' || kind === 'plan-revise') return { ready: true, blocked: false, blockerCause: '', plan: PLAN_TEXT }
    if (kind === 'plan-judge') return { verdict: label.endsWith(' r1') ? 'changes' : 'approve', feedback: label.endsWith(' r1') ? ['fix ' + label] : [] }
    if (kind === 'review') return { verdict: /r[12]$/.test(label) ? 'changes' : 'approve', feedback: /r[12]$/.test(label) ? ['fix ' + label] : [] }
    return { verified: true, blocked: false, escalate: false, prUrl: kind === 'investigate' ? '' : `https://github.com/o/r/pull/${s}`, branch: kind === 'investigate' ? '' : `audit-fix/${s}`, worktreePath: `/repo/.claude/worktrees/${s}`, blockerDiagnosis: '', summary: `${label} done` }
  }
  const calls = []
  const rows = []
  for (const args of [
    mkA(mkT('proj-fix-p', { model: 'opus', rung: 'opus-high', planGate: true })),
    mkA(mkT('proj-fix-a'), { defaultBranch: 'master', envBootstrap: 'poetry install', knownBaselineFailures: ['t — env'] }),
    mkA(mkT('proj-audit-x', { scope: 'read-only', planGate: true })),
  ]) {
    const r = await runTask(args, scripted)
    calls.push(JSON.stringify(r.calls))
    rows.push(JSON.stringify({ result: r.result, err: r.error && String(r.error) }))
  }
  ok(sha(calls.join('\n')) === 'ee821ac64ee16a13cf95c536bcbbf4ef7106c45c0d28c002f11b61196b1ee54b',
    'byte pin: three whole task-mode calls — every label and prompt unchanged (recorded on the p13-1 engine)')
  ok(sha(rows.join('\n')) === 'a0fc1e71bf09d45f3dad3d76a58959e2105789f4c1699242ef41dec1f2f967dd',
    'byte pin: three whole task-mode calls — every row, rung record included')
}

console.log()
console.log(fail === 0 ? 'ALL PASS' : 'SOME FAILED')
process.exit(fail)
