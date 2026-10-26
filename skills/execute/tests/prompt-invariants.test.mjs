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
//   - verify slots (p23-4)    → args.verifySlot is required (estate ADR 0009 d4): absent or null, runTask refuses
//                               before any dispatch in both modes, and so does a malformed value; set: the nine
//                               verifier-bearing builders render the wrapped line with SLOT_TEXT once, the four
//                               TASK_TREE_RULE builders and the review judge carry slotRule after KILL_RULE, only the
//                               integrator carries --priority, and the whole-call pins' slotted calls are their
//                               unslotted bytes plus exactly those pieces.
//   - touched tests (p31-1)   → the full suite runs at two Checkpoints (estate ADR 0009 d1): each Ralph try runs the
//                               touched tests and the verifier runs once, before the PR; the one-shot runs the verifier
//                               only when the touched tests are green; the reviser re-checks the same way; the review
//                               judge and the four tree agents observe with touched tests (the verifier only when the
//                               brief asks); args.touched pins how they are found; Integration's prompts are their
//                               pre-p31-1 bytes, and the whole-call pins swap p31-1's fragments back (P31_1).
//   - the Flake check (p29-9) → FLAKE_CHECK_TASK follows the verification block of every implementer, approved-plan
//                               implementer and reviser, FLAKE_CHECK_INTEGRATION follows integrationVerify in the
//                               integrator, once each and nowhere else; the whole-call pins swap them out (P29_9).
// Evaluates only the pure-function region of the engine (before the orchestration that needs Workflow
// globals) in a vm sandbox. Run: node tests/prompt-invariants.test.mjs   (exit 0 = pass)
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { loadEngine, runTask, VERIFY_SLOT } from '../../../tests/lib/engine.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(here, '..', 'task.workflow.js'), 'utf8')

const marker = '// ---- Orchestration'
const idx = src.indexOf(marker)
if (idx === -1) { console.error('FAIL - orchestration marker not found'); process.exit(1) }
let head = src.slice(0, idx).replace('export const meta', 'const meta')
head += '\nvar __t = { gateOverride, envBootstrapStep, worktreeSetup, escalationContext, verifyBlock, oneShotVerify, ralphLoop, implementerPrompt, plannerPrompt, planReviserPrompt, planJudgePrompt, approvedPlanImplementerPrompt, reviewJudgePrompt, reviserPrompt, groupedRounds, reviewHistoryBlock, stepBackBlock, parseGatedInputs, unapprovedGates, runAgent, planLoop, implement, reviewLoop, converge, BUILT_IN_LADDER, CAPPED_RETRY_ITERATIONS, rungState, startRung, cur, onTop, climbOf, implEffort, judgeEffort, escalate, readOnlyPrompt, roundBudgetDiagnosis, taskTreeSetup, fullSuiteLoop, touchedOf, touchedTests, observeTests, baselineManifest, integrationVerify };\n'

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
// leaves planGate false, and max_iterations is the built-in 3 (the template now holds a
// {{MAX_ITERATIONS}} placeholder that schedule fills from rollouts.toml, then the built-in). With no plan layer nothing climbs before the
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
// ADR 0038: every prompt that declares a gate teaches the one-line Cap, and the sub-bullets that carry its split.
ok(plPrompt.includes('"- spend: <what> — cap N USD"') && /ONE line whose Cap\s+holds the whole spend/.test(plPrompt) && /nested two spaces under its gate/.test(plPrompt),
  'plannerPrompt (ADR 0038): the one-line `cap N USD` gate, its split in nested sub-bullets')
ok(!/no prose, commentary/.test(plPrompt) && /no prose or footnotes/.test(plPrompt), 'plannerPrompt (ADR 0038): bullets only forbids prose and footnotes, never the sub-bullet commentary')
ok(prvPrompt.includes('`- spend: <what> — cap N USD`') && /whose Cap holds\s+the whole spend \(its split in nested sub-bullets\)/.test(prvPrompt), 'planReviserPrompt (ADR 0038): the one-line `cap N USD` gate')
ok(/Nested sub-bullets under a gate are commentary \(how a spend splits\) and are allowed; an\s+indented bullet is never a gate\./.test(pjPrompt) &&
  pjPrompt.includes('"- spend: <what> — cap N USD", one line WITH a hard cap') && !/commentary does not belong/.test(pjPrompt), 'planJudgePrompt (ADR 0038): sub-bullets are allowed, the gate is one line with a hard cap')
{
  const E = loadEngine(['GATED_INPUTS_CHECK', 'IMPL_RESULT'])
  for (const [name, text] of [['GATED_INPUTS_CHECK', E.GATED_INPUTS_CHECK], ['IMPL_RESULT.gatedInputs', E.IMPL_RESULT.properties.gatedInputs.description]]) {
    ok(/"spend: <what> — cap N USD", one line whose Cap holds the whole spend, with\s+how it splits in blockerDiagnosis/.test(text), `${name} (ADR 0038): the one-line Cap, its split in blockerDiagnosis`)
  }
  ok(/CEILING to respect,\s+never a target/.test(E.GATED_INPUTS_CHECK), 'GATED_INPUTS_CHECK: an approved cap is still a ceiling, never a target')
}

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
// A doubled heading (chorus-rollout-2026-10-06, p20-4): the planner wrote "## Gated inputs" then
// "### Gated inputs" / "None", the judge approved, and the parser stopped at the inner heading — no gate,
// no None, plan-blocked. A Gated inputs heading inside the section is the same section, not its end.
const doubledNone = T.parseGatedInputs('PLAN\n## Gated inputs\n### Gated inputs\nNone\n### Risks')
ok(doubledNone !== null && doubledNone.length === 0, 'parseGatedInputs: a doubled heading ("## Gated inputs" then "### Gated inputs" / None) is the empty declaration')
const doubledGate = T.parseGatedInputs('PLAN\n## Gated inputs\n\n### Gated inputs\n- spend: Replicate API — cap USD 30\n### Risks\n- credential: not a gate')
ok(doubledGate && doubledGate.length === 1 && doubledGate[0] === 'spend: Replicate API — cap USD 30', 'parseGatedInputs: a doubled heading keeps its gates, and the next other heading still ends the section')
const doubledSplit = T.parseGatedInputs('PLAN\n### Gated inputs\n- credential: PROD_API_KEY\n#### Gated inputs\n- spend: x — cap $5\n### Risks')
ok(doubledSplit && doubledSplit.length === 2 && doubledSplit[1] === 'spend: x — cap $5', 'parseGatedInputs: gates on both sides of a doubled heading are all declared (fail-safe — none dropped)')

// ADR 0038: a spend gate is ONE line whose Cap holds the whole spend, and how it splits goes in sub-bullets under it.
// Columns are counted (a tab advances to the next multiple of 4), so a tab sub-bullet is nested, and a one-space
// unlabelled sub-bullet under a column-0 gate is commentary. Only a real column-0 gate makes a column-1 item
// commentary: a None, prose, an empty item or a doubled heading never does, and a column-1 item labelled with a gate
// kind is always a declaration (Obsidian renders a one-space bullet as a sibling, so it looks like a gate to Lachy).
const pg = (body) => T.parseGatedInputs('PLAN\n### Gated inputs\n' + body + '\n### Risks')
const G24 = '- spend: eval re-runs — cap 24 USD'
const one = (r, want, label) => ok(r && r.length === want.length && want.every((w, i) => r[i] === w), `parseGatedInputs (ADR 0038): ${label} → ${JSON.stringify(r)}`)
one(pg(`${G24}\n\t- up to 6 invocations at --max-cost-usd 4`), ['spend: eval re-runs — cap 24 USD'], 'a tab sub-bullet under a gate is commentary')
one(pg(`${G24}\n - up to 6 invocations at --max-cost-usd 4`), ['spend: eval re-runs — cap 24 USD'], 'a one-space sub-bullet under a gate is commentary')
one(pg(`${G24}\n\n - up to 6 invocations at --max-cost-usd 4`), ['spend: eval re-runs — cap 24 USD'], 'a blank line then a one-space sub-bullet under a gate is commentary (a loose list)')
one(pg(' - spend: x — cap 5 USD'), ['spend: x — cap 5 USD'], 'a one-space item with no gate above is a declaration')
one(pg('- None\n - spend: x — cap 5 USD'), ['spend: x — cap 5 USD'], 'a None never makes a column-1 gate commentary')
one(pg('- None\n - up to 6 calls'), ['up to 6 calls'], 'a None never makes a column-1 item commentary (fail-closed)')
one(pg(`${G24}\n - spend: B — cap 3 USD`), ['spend: eval re-runs — cap 24 USD', 'spend: B — cap 3 USD'], 'a column-1 item labelled with a gate kind is a declaration')
one(pg(`${G24}\nThe split is below.\n - up to 6 calls`), ['spend: eval re-runs — cap 24 USD', 'up to 6 calls'], 'column-0 prose ends "under a gate"')
one(pg(' - spend: A — cap 5 USD\n - credential: KEY'), ['spend: A — cap 5 USD', 'credential: KEY'], 'two column-1 gates with nothing above both stay gates')
one(pg('- spend: Replicate API for the full corpus re-render —\n\tcap 5 USD'), ['spend: Replicate API for the full corpus re-render — cap 5 USD'], 'a tab-indented wrap keeps its cap')
one(pg(' - spend: A — cap 5 USD\n - up to 6 calls'), ['spend: A — cap 5 USD', 'up to 6 calls'], 'a column-1 gate never makes the next column-1 item commentary')
one(pg('- Credential: KEY\n  - from 1Password\n1. Spend: y — cap 2 USD\n   - two runs'), ['Credential: KEY', 'Spend: y — cap 2 USD'], 'any gate kind and a numbered marker, each with a 2-space or 3-space sub-bullet')

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

// Scenario gate-G (chorus-rollout-2026-10-06, p20-4) — an approved plan with a doubled Gated inputs
// heading ("## Gated inputs" then "### Gated inputs" / "None") is a clean None, not plan-blocked.
effortCalls.length = 0
ctx.agent = recordingAgent(async (prompt, opts) => {
  if (opts.label.startsWith('plan-judge:')) return { verdict: 'approve', feedback: [] }
  if (opts.label.startsWith('plan:')) return { ready: true, blocked: false, blockerCause: '', plan: 'PLAN\n## Gated inputs\n\n### Gated inputs\nNone\n\n### Risks / unknowns\n- none' }
  if (opts.phase === 'Implement') return greenImpl
  return { verdict: 'approve', feedback: [] }
})
const gDoubled = await T.converge({ ...baseEff, slug: 'proj-gate-g', scope: 'cross-cutting', planGate: true }, aEff)
ok(gDoubled && gDoubled.status === 'review', 'gate G: a doubled Gated inputs heading over None is not plan-blocked — the task lands')
ok(call('implement:proj-gate-g'), 'gate G: implementation proceeds on the doubled-heading None')

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

// The ten agent builders over one fixture that reaches each variant: the bottom-rung and climbed implementers,
// both revisers, the read-only agents, the judges and Integration's two agents. They are git-env-scrub's ten (its
// (e2) proves every runAgent site is one of them). Shared by the RM_RULE and KILL_RULE blocks below.
const RULE_BUILDERS = ['rungState', 'escalate', 'implementerPrompt', 'approvedPlanImplementerPrompt', 'reviserPrompt', 'readOnlyPrompt',
  'plannerPrompt', 'planReviserPrompt', 'planJudgePrompt', 'reviewJudgePrompt', 'integratorPrompt', 'integrationReviewPrompt']
// over: extra rollout args (p31-1 renders the Integration builders with a baseline, a slot and args.touched).
function agentPrompts(E, over = {}) {
  const H = (c) => c.repeat(40)
  const tk = { slug: 'proj-fix-x', taskPath: '/vault/proj-fix-x.md', maxIterations: 3, scope: 'cross-cutting' }
  const im = { prUrl: 'https://github.com/o/r/pull/1', worktreePath: '/repo/.claude/worktrees/proj-fix-x', branch: 'audit-fix/fix-x' }
  const ar = { repoPath: '/repo', verifier: 'make test', rolloutSlug: 'r', ...over }
  const I = {
    prUrl: im.prUrl, branch: im.branch, worktreePath: im.worktreePath, headSha: H('a'), taskBase: H('b'), mainSha: H('c'), trouble: ['conflict'],
    landed: [{ prUrl: 'https://github.com/o/r/pull/2', title: 't', files: ['a.js'], taskPath: '/vault/t.md' }],
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
  return prompts
}

// ---- Removing files (p12-12, the 2026-10-01 stall): RM_RULE in every agent prompt ----------
// An agent's `cd /tmp/x && rm -rf ./*` stalled an unattended rollout 13 h on Claude Code's bypass-immune
// removal ask. RM_RULE names the safe forms, and every builder renders it once, right after GIT_ENV_RULE.
{
  const E = loadEngine(['GIT_ENV_RULE', 'RM_RULE', ...RULE_BUILDERS])
  const prompts = agentPrompts(E)
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

// ---- Stopping processes (p18-1, the 2026-10-04 incident): KILL_RULE in every agent prompt ----------
// An implementer's `pkill -n` on the verifier's pattern killed the lead's Integration verify: the lead, other agents
// and other sessions run the same verifier on one machine. KILL_RULE says to stop only a process the agent started,
// by its pid or process group, never by name or pattern. It is static and one line, and every builder renders it
// once, right after RM_RULE.
{
  const E = loadEngine(['RM_RULE', 'KILL_RULE', ...RULE_BUILDERS])
  const prompts = agentPrompts(E)
  const NAMES = ['`pkill`', '`killall`', 'pgrep', 'pid', '`kill <pid>`', 'process group']
  const times = (hay, needle) => hay.split(needle).length - 1
  // [] when the rule and every prompt hold; else what failed.
  const killRuleFails = (rule, rmRule, byName) => {
    const out = []
    if (typeof rule !== 'string' || !rule || rule.includes('\n')) out.push('rule: one line')
    if (/\$\{|'/.test(String(rule))) out.push('rule: static, no apostrophe')
    for (const f of NAMES) if (!String(rule).includes(f)) out.push(`rule: names ${f}`)
    for (const [name, ps] of Object.entries(byName)) {
      for (const p of ps) {
        if (times(p, rule) !== 1) out.push(`${name}: KILL_RULE once`)
        if (!p.includes(rmRule + '\n\n' + rule)) out.push(`${name}: KILL_RULE right after RM_RULE`)
      }
    }
    return out
  }
  ok(Object.keys(prompts).length === 10, 'KILL_RULE: the ten agent builders are covered')
  ok(JSON.stringify(killRuleFails(E.KILL_RULE, E.RM_RULE, prompts)) === '[]', 'KILL_RULE: one static line naming pkill, killall, pgrep and the pid, once in every prompt, right after RM_RULE')
  const stripped = { ...prompts, integratorPrompt: prompts.integratorPrompt.map((p) => p.replace('\n\n' + E.KILL_RULE, '')) }
  ok(killRuleFails(E.KILL_RULE, E.RM_RULE, stripped).length > 0, 'KILL_RULE control: a prompt with KILL_RULE stripped fails')
  const lax = E.KILL_RULE.replace('`killall`, ', '')
  const relaxed = Object.fromEntries(Object.entries(prompts).map(([k, ps]) => [k, ps.map((p) => p.replace(E.KILL_RULE, lax))]))
  ok(lax !== E.KILL_RULE && killRuleFails(lax, E.RM_RULE, relaxed).length > 0, 'KILL_RULE control: a rule without killall fails')
}

// ---- Needs a human (p16-3): NEEDS_HUMAN_RULE at the end of exactly five builders, needsHuman on three schemas --
// The plan judge, the review judge and IMPL_RESULT's implementer and investigator may stop on a question only a
// person can answer. The rule is static, rendered once at the END of every variant of those five builders, and
// in no other builder: the reviser shares IMPL_RESULT but keeps its byte-pinned prompt; the planner, plan reviser
// and Integration's agents never ask.
{
  const E = loadEngine(['NEEDS_HUMAN_RULE', 'askOf', 'rungState', 'escalate', 'implementerPrompt', 'approvedPlanImplementerPrompt', 'reviserPrompt', 'readOnlyPrompt',
    'plannerPrompt', 'planReviserPrompt', 'planJudgePrompt', 'reviewJudgePrompt', 'integratorPrompt', 'integrationReviewPrompt',
    'PLAN_VERDICT', 'PLAN_JUDGE', 'IMPL_RESULT', 'REVIEW_VERDICT', 'INTEGRATE_RESULT', 'INTEGRATION_REVIEW'])
  const H = (c) => c.repeat(40)
  const tk = { slug: 'proj-fix-x', taskPath: '/vault/proj-fix-x.md', maxIterations: 3, scope: 'cross-cutting' }
  const im = { prUrl: 'https://github.com/o/r/pull/1', worktreePath: '/repo/.claude/worktrees/proj-fix-x', branch: 'audit-fix/fix-x' }
  const ar = { repoPath: '/repo', verifier: 'make test', rolloutSlug: 'r' }
  const arB = { ...ar, knownBaselineFailures: ['t — env'] }
  const I = {
    prUrl: im.prUrl, branch: im.branch, worktreePath: im.worktreePath, headSha: H('a'), taskBase: H('b'), mainSha: H('c'), trouble: ['conflict'],
    landed: [{ prUrl: 'https://github.com/o/r/pull/2', title: 't', files: ['a.js'], taskPath: '/vault/t.md' }],
    reviewHistory: [{ round: 1, feedback: ['fix it'] }], reviewRoundsUsed: 1,
    rung: { startRung: 'opus-high', rung: 'opus-xhigh', climbs: [] },
  }
  const J = { mergeCommit: H('d'), headSha: H('e'), baseSha: H('c'), triggers: ['conflict'], path: 'integrator' }
  const climbed = E.rungState(tk, ar)
  E.escalate(climbed, tk.slug, 'implement')
  const states = [E.rungState(tk, ar), climbed]
  const hist = [{ round: 1, feedback: ['a'] }, { round: 2, feedback: ['b'] }]
  const withRule = {
    implementerPrompt: [...states.map((st) => E.implementerPrompt(tk, ar, st, '')), E.implementerPrompt({ ...tk, ignoreGate: true }, arB, climbed, 'prior attempt')],
    approvedPlanImplementerPrompt: [...states.map((st) => E.approvedPlanImplementerPrompt(tk, 'PLAN', ar, st, '')), E.approvedPlanImplementerPrompt(tk, 'PLAN', arB, climbed, 'prior')],
    readOnlyPrompt: [E.readOnlyPrompt(tk, ar, states[0], ''), E.readOnlyPrompt(tk, arB, climbed, 'prior')],
    planJudgePrompt: [E.planJudgePrompt(tk, 'PLAN', ar)],
    reviewJudgePrompt: [E.reviewJudgePrompt(tk, im, ar, []), E.reviewJudgePrompt(tk, im, ar, hist), E.reviewJudgePrompt(tk, im, arB, hist)],
  }
  const without = {
    plannerPrompt: [E.plannerPrompt(tk, ar, states[0], '')],
    planReviserPrompt: [E.planReviserPrompt(tk, 'PLAN', [{ round: 1, feedback: ['fix it'] }], 2, ar)],
    reviserPrompt: [E.reviserPrompt(tk, im, hist.slice(0, 1), 2, ar, ''), E.reviserPrompt(tk, im, hist, 3, ar, 'PLAN', { history: hist, roundsUsed: 2 })],
    integratorPrompt: [E.integratorPrompt(tk, ar, I)],
    integrationReviewPrompt: [E.integrationReviewPrompt(tk, ar, I, J)],
  }
  const WORDS = ['value', 'design choice', 'out-of-band', 'never needsHuman', 'test failure', 'gated', '## Repair input', 'blocked=true', '"changes"']
  const times = (hay, needle) => hay.split(needle).length - 1
  // [] when the rule and every prompt hold; else what failed.
  const ruleFails = (rule, inBy, outBy) => {
    const out = []
    if (typeof rule !== 'string' || !rule.startsWith('\n\n') || rule.trim() === '') out.push('rule: its own leading blank line')
    for (const w of WORDS) if (!String(rule).includes(w)) out.push(`rule: names ${w}`)
    if (/\$\{/.test(String(rule))) out.push('rule: static')
    for (const [name, ps] of Object.entries(inBy)) {
      for (const p of ps) {
        if (times(p, rule) !== 1) out.push(`${name}: rule once`)
        if (!p.endsWith(rule)) out.push(`${name}: rule at the end`)
      }
    }
    for (const [name, ps] of Object.entries(outBy)) for (const p of ps) if (p.includes('needsHuman')) out.push(`${name}: no needsHuman`)
    return out
  }
  ok(Object.keys(withRule).length + Object.keys(without).length === 10, 'NEEDS_HUMAN_RULE: the ten agent builders are covered')
  ok(JSON.stringify(ruleFails(E.NEEDS_HUMAN_RULE, withRule, without)) === '[]',
    'NEEDS_HUMAN_RULE: static, names its limits, once at the END of every variant of the five asking builders, in no other builder')
  const stripped = { ...withRule, reviewJudgePrompt: withRule.reviewJudgePrompt.map((p) => p.replace(E.NEEDS_HUMAN_RULE, '')) }
  ok(ruleFails(E.NEEDS_HUMAN_RULE, stripped, without).length > 0, 'NEEDS_HUMAN_RULE control: a prompt with the rule stripped fails')
  const leaked = { ...without, reviserPrompt: without.reviserPrompt.map((p) => p + E.NEEDS_HUMAN_RULE) }
  ok(ruleFails(E.NEEDS_HUMAN_RULE, withRule, leaked).length > 0, 'NEEDS_HUMAN_RULE control: the rule in the reviser fails')
  // The schemas: an optional string on exactly the three asking schemas.
  const asking = { PLAN_JUDGE: E.PLAN_JUDGE, REVIEW_VERDICT: E.REVIEW_VERDICT, IMPL_RESULT: E.IMPL_RESULT }
  for (const [name, s] of Object.entries(asking)) {
    ok(s.properties.needsHuman && s.properties.needsHuman.type === 'string' && !s.required.includes('needsHuman') &&
      /design choice/.test(s.properties.needsHuman.description), `schema: ${name} carries an optional needsHuman string`)
  }
  for (const [name, s] of Object.entries({ PLAN_VERDICT: E.PLAN_VERDICT, INTEGRATE_RESULT: E.INTEGRATE_RESULT, INTEGRATION_REVIEW: E.INTEGRATION_REVIEW })) {
    ok(!('needsHuman' in s.properties) && !s.required.includes('needsHuman'), `schema: ${name} has no needsHuman`)
  }
  ok(E.askOf({ needsHuman: '  q?  ' }) === 'q?' && E.askOf({ needsHuman: ' \n ' }) === '' && E.askOf({ needsHuman: 7 }) === '' &&
    E.askOf({ needsHuman: ['q'] }) === '' && E.askOf({}) === '' && E.askOf(null) === '', 'askOf: the trimmed string, else ""')
}

// ---- Verify slots (p23-4): args.verifySlot wraps every verifier line the engine renders ------------------------
// With args.verifySlot = { script, slots }, the nine verifier-bearing builders render the wrapped line
// (`<scrub> python3 '<script>' run --slots N -- bash -c '<verifier>'`), never the bare scrubbed verifier; SLOT_TEXT
// sits once in each (beside the verify block's `- Verifier:` line, or in slotRule); the four TASK_TREE_RULE builders
// and, since p31-1 (its tests block may run the verifier when the brief asks), the review judge carry slotRule right
// after KILL_RULE; only the integrator's line carries `--priority`; the Integration review judge renders no verifier
// and stays byte-identical. The renderers still take an absent slot (slotted(V, undefined) is scrubbed(V));
// the engine's entry refuses a call without one (estate ADR 0009 d4), and the whole-call pins below show the slotted
// calls are their unslotted bytes plus exactly the slot pieces.
{
  const E = loadEngine(['KILL_RULE', 'SLOT_TEXT', 'GIT_ENV_SCRUB', 'shq', 'slotted', 'slotRule', 'scrubbed', 'verifySlotArgsError', ...RULE_BUILDERS])
  const V = `make test && echo "it's $HOME"`
  const SLOT = { script: '/plugins/thread/1.0.0/skills/execute/scripts/verify-slot.py', slots: 2 }
  const H = (c) => c.repeat(40)
  const tk = { slug: 'proj-fix-x', taskPath: '/vault/proj-fix-x.md', maxIterations: 3, scope: 'cross-cutting' }
  const im = { prUrl: 'https://github.com/o/r/pull/1', worktreePath: '/repo/.claude/worktrees/proj-fix-x', branch: 'audit-fix/fix-x' }
  const I = {
    prUrl: im.prUrl, branch: im.branch, worktreePath: im.worktreePath, headSha: H('a'), taskBase: H('b'), mainSha: H('c'), trouble: ['conflict'],
    landed: [], reviewHistory: [{ round: 1, feedback: ['fix it'] }], reviewRoundsUsed: 1,
    rung: { startRung: 'opus-high', rung: 'opus-xhigh', climbs: [] },
  }
  const J = { mergeCommit: H('d'), headSha: H('e'), baseSha: H('c'), triggers: ['conflict'], path: 'integrator' }
  const render = (ar) => {
    const climbed = E.rungState(tk, ar)
    E.escalate(climbed, tk.slug, 'implement')
    const states = [E.rungState(tk, ar), climbed]
    return {
      implementerPrompt: states.map((st) => E.implementerPrompt(tk, ar, st, '')),
      approvedPlanImplementerPrompt: states.map((st) => E.approvedPlanImplementerPrompt(tk, 'PLAN', ar, st, '')),
      reviserPrompt: [E.reviserPrompt(tk, im, [{ round: 1, feedback: ['fix it'] }], 2, ar, '')],
      readOnlyPrompt: [E.readOnlyPrompt(tk, ar, states[0], '')],
      plannerPrompt: [E.plannerPrompt(tk, ar, states[0], '')],
      planJudgePrompt: [E.planJudgePrompt(tk, 'PLAN', ar)],
      planReviserPrompt: [E.planReviserPrompt(tk, 'PLAN', [{ round: 1, feedback: ['fix it'] }], 2, ar)],
      integratorPrompt: [E.integratorPrompt(tk, ar, I)],
      reviewJudgePrompt: [E.reviewJudgePrompt(tk, im, ar, [])],
      integrationReviewPrompt: [E.integrationReviewPrompt(tk, ar, I, J)],
    }
  }
  const base = { repoPath: '/repo', verifier: V, rolloutSlug: 'r' }
  const off = render(base)
  const on = render({ ...base, verifySlot: SLOT })
  const onB = render({ ...base, verifySlot: SLOT, knownBaselineFailures: ['t — env'] })
  const BEARING = ['implementerPrompt', 'approvedPlanImplementerPrompt', 'reviserPrompt', 'readOnlyPrompt', 'plannerPrompt',
    'planJudgePrompt', 'planReviserPrompt', 'reviewJudgePrompt', 'integratorPrompt']
  // The builders that carry slotRule right after KILL_RULE: the four TASK_TREE_RULE agents and the review judge (p31-1).
  const TREE = ['readOnlyPrompt', 'plannerPrompt', 'planJudgePrompt', 'planReviserPrompt', 'reviewJudgePrompt']
  const times = (hay, needle) => hay.split(needle).length - 1
  const wrapped = E.slotted(V, SLOT)
  const prio = E.slotted(V, { ...SLOT, priority: true })
  // [] when every prompt holds; else what failed.
  const slotFails = (byName, rule) => {
    const out = []
    for (const name of BEARING) {
      for (const p of byName[name]) {
        const line = name === 'integratorPrompt' ? prio : wrapped
        if (!p.includes(line)) out.push(`${name}: the wrapped line`)
        if (p.includes(E.scrubbed(V))) out.push(`${name}: no bare scrubbed verifier`)
        if (times(p, E.SLOT_TEXT) !== 1) out.push(`${name}: SLOT_TEXT once`)
        if (name === 'integratorPrompt' ? times(p, `run --slots ${SLOT.slots} --priority --`) !== 1 : p.includes('--priority')) out.push(`${name}: --priority only in the integrator, once`)
        if (TREE.includes(name) && !p.includes(E.KILL_RULE + rule(name))) out.push(`${name}: slotRule right after KILL_RULE`)
      }
    }
    return out
  }
  const ruleOf = () => E.slotRule(V, SLOT)
  ok(JSON.stringify(slotFails(on, ruleOf)) === '[]', 'verifySlot: the nine verifier-bearing builders render the wrapped line once-noted, slotRule after KILL_RULE in the four tree builders and the review judge, --priority only in the integrator')
  ok(JSON.stringify(slotFails(onB, ruleOf)) === '[]', 'verifySlot: … with a baseline manifest too')
  ok(on.integrationReviewPrompt[0] === off.integrationReviewPrompt[0], 'verifySlot: integrationReviewPrompt is byte-identical with and without it (it renders no verifier)')
  ok(on.reviewJudgePrompt[0] !== off.reviewJudgePrompt[0], 'verifySlot: the review judge is no longer byte-identical with and without it (p31-1: its tests block and slotRule)')
  for (const name of TREE) {
    ok(on[name][0].replace(E.slotRule(V, SLOT), '') === off[name][0].replace(E.scrubbed(V), wrapped), `verifySlot: ${name} is its unslotted bytes, the wrapped line in place of the scrubbed one, plus exactly slotRule`)
  }
  // controls: each fails exactly its check
  const noRule = { ...on, planJudgePrompt: on.planJudgePrompt.map((p) => p.replace(E.slotRule(V, SLOT), '')) }
  ok(slotFails(noRule, ruleOf).some((f) => f.startsWith('planJudgePrompt:')), 'verifySlot control: a plan judge without slotRule fails')
  const noJudgeRule = { ...on, reviewJudgePrompt: on.reviewJudgePrompt.map((p) => p.replace(E.slotRule(V, SLOT), '')) }
  ok(JSON.stringify(slotFails(noJudgeRule, ruleOf)) === JSON.stringify(['reviewJudgePrompt: SLOT_TEXT once', 'reviewJudgePrompt: slotRule right after KILL_RULE']), 'verifySlot control: a review judge without slotRule fails')
  const prioLeak = { ...on, implementerPrompt: on.implementerPrompt.map((p) => p.replace(wrapped, prio)) }
  ok(slotFails(prioLeak, ruleOf).some((f) => f === 'implementerPrompt: --priority only in the integrator, once'), 'verifySlot control: --priority in a task-call builder fails')
  ok(typeof E.SLOT_TEXT === 'string' && !E.SLOT_TEXT.includes('\n') && !/['$]|\$\{/.test(E.SLOT_TEXT) && !/`[^`]*\bgit\s/.test(E.SLOT_TEXT) &&
    E.SLOT_TEXT.includes('`kill <pid>`') && E.SLOT_TEXT.includes('7200000'), 'SLOT_TEXT: one static line, no apostrophe or git span; it names the pid stop and the long timeout')
  ok(wrapped.startsWith(E.GIT_ENV_SCRUB + " python3 '" + SLOT.script + "' run --slots 2 -- bash -c '"), 'slotted: the scrub, then the wrapper, then bash -c')
  ok(E.slotted(V, undefined) === E.scrubbed(V) && E.slotted(V, null) === E.scrubbed(V), 'slotted: absent ⇒ exactly scrubbed()')
  // shq round-trips through bash -c
  for (const w of [V, "a'b", "'", "$(echo no)", '`echo no`', 'x\\y', '']) {
    const r = spawnSync('bash', ['-c', `printf %s ${E.shq(w)}`], { encoding: 'utf8' })
    ok(r.status === 0 && r.stdout === w, `shq: ${JSON.stringify(w)} round-trips through bash -c`)
  }
  // runTask refuses a bad verifySlot before any agent() call, in both modes
  const LADDER = { source: 'built-in', rungs: [{ name: 'opus-high', model: 'opus', effort: 'high', judge: 'high', review: 'xhigh' }] }
  const mk = (verifySlot, mode) => ({
    rolloutSlug: 'r', repoPath: '/repo', verifier: 'make test', date: '2026-10-18', ladder: LADDER, verifySlot,
    task: { slug: 'proj-fix-x', taskPath: '/vault/proj-fix-x.md', scope: 'cross-cutting', planGate: false, maxIterations: 3, maxReviewRounds: 3, maxPlanRounds: 3 },
    ...(mode ? { mode } : {}),
  })
  const BAD = [['a string', SLOT.script], ['an extra key', { ...SLOT, extra: 1 }], ['priority: true', { ...SLOT, priority: true }],
    ['a relative script', { script: 'skills/execute/scripts/verify-slot.py', slots: 2 }], ['a multi-line script', { script: '/a/verify-slot.py\n/b/verify-slot.py', slots: 2 }],
    ['a wrong basename', { script: '/a/verify.py', slots: 2 }], ['an unexported plugin root', { script: '/skills/execute/scripts/verify-slot.py', slots: 2 }], ['slots 0', { ...SLOT, slots: 0 }], ['slots 1.5', { ...SLOT, slots: 1.5 }]]
  for (const mode of [undefined, 'integrate']) {
    for (const [what, v] of BAD) {
      const r = await runTask(mk(v, mode), async () => { throw new Error('agent() must not run') })
      ok(r.error && /args\.verifySlot/.test(String(r.error)) && r.calls.length === 0, `runTask (${mode || 'task'} mode) refuses verifySlot ${what} before any agent() call`)
    }
  }
  ok(E.verifySlotArgsError(SLOT) === '' && E.verifySlotArgsError(undefined) !== '' && E.verifySlotArgsError(null) !== '', 'verifySlotArgsError: { script, slots } passes; absent and null are refused by the same check')
  // estate ADR 0009 d4: an absent or null verifySlot is refused before any agent() call, in both modes, naming what to
  // pass. The runtime passes args JSON-stringified, which drops an undefined key, so that form is run too.
  const REQUIRED = /args\.verifySlot: is required \(estate ADR 0009 d4\): pass this entry's verify-timeout verifySlot, verbatim/
  const absent = (mode) => { const { verifySlot: _drop, ...rest } = mk(undefined, mode); return rest }
  const ABSENT = [['absent', (mode) => absent(mode)], ['absent (stringified args)', (mode) => JSON.stringify(absent(mode))],
    ['undefined', (mode) => mk(undefined, mode)], ['null', (mode) => mk(null, mode)]]
  for (const mode of [undefined, 'integrate']) {
    for (const [what, args] of ABSENT) {
      const r = await runTask(args(mode), async () => { throw new Error('agent() must not run') })
      ok(r.error && REQUIRED.test(String(r.error.message)) && r.calls.length === 0, `runTask (${mode || 'task'} mode) refuses verifySlot ${what} before any agent() call, naming what to pass`)
    }
  }
  // control: the same engine with the required check cut dispatches an unslotted call, so the cases above would catch
  // the check being removed.
  const cut = src.replace(/(function verifySlotArgsError\(v\) \{\n)  if \(v === undefined \|\| v === null\) return [^\n]*\n/, "$1  if (v === undefined || v === null) return ''\n")
  ok(cut !== src && !cut.includes('is required (estate ADR 0009 d4)'), 'verifySlot control: the required check is cut from the variant')
  for (const mode of [undefined, 'integrate']) {
    const args = mode ? { ...absent(mode), integration: { ...I, startedAt: '2026-10-18T10:00:00Z' } } : absent(mode)
    const r = await runTask(args, async () => { throw new Error('stub') }, { source: cut })
    ok(!(r.error && /args\.verifySlot/.test(String(r.error.message))) && r.calls.length > 0, `verifySlot control (${mode || 'task'} mode): without the check an absent verifySlot reaches agent()`)
  }
}

// ---- Touched tests between Checkpoints (p31-1, estate ADR 0009 d1) ---------------------------------------------
// The full suite (the rollout's verifier) runs at two Checkpoints per task: a code-writing agent's last check before
// it opens or updates its PR (the implementer's, and each reviser's) and Integration before the merge. Every other
// verify runs the touched tests: each Ralph try of an implementer or a reviser (then the verifier once, before the
// PR), the one-shot (the verifier only when the touched tests are green), the review judge's own check (only when its
// read rule holds) and the four tree agents' observations (the verifier only when the task brief asks for the full
// suite). Integration is unchanged: PRE_P31 holds sha256 pins recorded on dc07aa5, BEFORE the p31-1
// edit, of its two agents' prompts, the pre-p31-1 ralphLoop (now fullSuiteLoop, Integration's loop), the pre-p31-1
// oneShotVerify (preOneShot below, the swap-back literal) and the integrator's manifest.
// p29-9 (ADR 0050): the Flake check blocks, appended as `\n<block>` right after each code-writing prompt's verification
// block and after integrationVerify in the integrator, never inside a loop renderer. P29_9 holds [new, old] (old ''),
// applied BEFORE preP31: a prompt with the blocks swapped out is its pre-p29-9 bytes, which then chain to every older
// base as before.
const P29X = loadEngine(['FLAKE_CHECK_TASK', 'FLAKE_CHECK_INTEGRATION', 'flakeCheck', 'GIT_ENV_SCRUB', 'DIFF_FILES'])
const P29_9 = [['\n' + P29X.FLAKE_CHECK_TASK, ''], ['\n' + P29X.FLAKE_CHECK_INTEGRATION, '']]
const preP29 = (p) => P29_9.reduce((x, [nw, od]) => x.split(nw).join(od), p)
// The p29-9 pins (each the p29-9 base, the pin p31-1 recorded, plus exactly the blocks).
const P29_PINS = {
  integrator: '640cb573dece267eca668e14e3e6649c726ed80ad79a8224f8735639494d7be9', // agentPrompts' 2 fixtures × baseline/none × slot/none
  r2: '83e62457a38eeb10f70f964a4679a67177027eaf81a021caae0877e512a7871a', // the unseeded round-2 reviser
  r3: '1309d674cedb9d955af05f895d6805b3e2cb03496dc24e7a8b663fb6a1a1f37e', // the unseeded round-3 reviser with the plan
  calls: '867dbc843c58399e743049254a4dc9631af1d8180a2158330eaf7e13cd548863', // three whole task-mode calls, unslotted
  slotted: '66a3293284ce77d41a3826e0f9f24b6d0194a2096de8da090b1a01410c3ccfbd', // the same calls as run, slotted
  rows: 'bc54de03bfb55e50cd8c6ead033b2da5c8ea789df8b0945c96ca54690a5398fb', // their rows, flakes included
}
const PRE_P31 = {
  integrator: '5e13e60b47a68c76da50b467c1a84243b2d3ddedcb24af16d15374c27e71e4a8', // agentPrompts' 2 fixtures × baseline/none × slot/none
  integrationReview: '1fe90542e90840a835b0dbe3e790d8fb1a9cea047f666fd209a65bb8bae29398', // agentPrompts' 2 fixtures
  ralph: 'fe643bca0565ea08227a68722ee4054936e8aca671ca0aa3d4d0708ec95bfeca', // ralphLoop('make test', n {2,3}, baseline/none, slot/none/priority)
  oneShot: '0ab3700329eb89c84bcd70c556208e6d8ca0748a47b599bdf1b24476cc3dba6d', // oneShotVerify('make test', baseline/none, slot/none)
  manifest: 'bf4f9ac1a846a8d8dfc860459e2698d6fe4e8aa1ec4cbe07adbc151929b1828b', // baselineManifest({ knownBaselineFailures: ['t — env'] })
}
const P31X = loadEngine(['slotted', 'slotNote', 'slotRule', 'ralphLoop', 'fullSuiteLoop', 'oneShotVerify', 'observeTests', 'reviewTests'])
// The pre-p31-1 oneShotVerify, verbatim: its renders hash to PRE_P31.oneShot (the p31-1 block checks it).
function preOneShot(verifier, baseline, slot) {
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
- Verifier: ${P31X.slotted(verifier, slot)}${P31X.slotNote(slot)}
- Run the verifier EXACTLY ONCE.${green}
- If green: the work is verified — proceed.
- If red (any failure outside the green criterion): do NOT attempt a fix, do NOT run the verifier again,
  and do NOT open/update a PR. Commit your work so far on the branch (so the next rung inherits it),
  append a one-paragraph diagnosis of the failure to the task note under a "## Blocker diagnosis"
  heading, and return escalate=true, verified=false, blocked=false with the same diagnosis in
  blockerDiagnosis. The next rung up (a stronger model or more effort) picks up your worktree and
  iterates from there.`.trim()
}
// The task calls' manifest tail [new, old]; integratorPrompt (baselineManifest(a, true)) keeps the old one.
const MANIFEST_P31 = [
  'Do NOT try to fix them, do NOT flag them as findings, and do NOT `--deselect`/skip them\nfrom any run, touched or full (that would hide a real regression). Only a NEW failure — or a baseline test\nfailing in a way that does not match its listed reason — is yours to act on.',
  'Do NOT try to fix them, do NOT flag them as findings, and do NOT `--deselect`/skip them (that would hide a\nreal regression). Keep running the full verifier; only a NEW failure — or a baseline test failing in a way\nthat does not match its listed reason — is yours to act on.',
]
// p31-1's [new, old, label] fragments for one slot state (undefined: the unslotted calls; the pins' slot: the slotted
// ones), the way P23_1 holds p23-1's; the slot state matters here, unlike there. The loop pairs are the new loop
// against fullSuiteLoop (the old one, verbatim: PRE_P31.ralph proves it) and the one-shot pairs the new one against
// preOneShot; the rest are literal fragments, each old '' anchored on its neighbour. The review judge's slotRule pair
// is an identity when unslotted: unslot() already takes slotRule out.
function p31Pairs(slot) {
  const V = 'make test'
  const pairs = []
  for (const n of [2, 3]) {
    for (const b of [undefined, ['t — env']]) pairs.push([P31X.ralphLoop(V, n, b, slot, ''), P31X.fullSuiteLoop(V, n, b, slot), `loop n=${n}${b ? ' baseline' : ''}`])
  }
  for (const b of [undefined, ['t — env']]) pairs.push([P31X.oneShotVerify(V, b, slot, ''), preOneShot(V, b, slot), `one-shot${b ? ' baseline' : ''}`])
  pairs.push([...MANIFEST_P31, 'manifest'])
  pairs.push([`   - to capture the baseline, ${P31X.observeTests('the files the plan will change', '', V, slot)}\n`,
    `   - run the verifier ONCE from the task tree to capture the baseline (\`${P31X.slotted(V, slot)}\`) — observe only, write no fix code\n`, 'planner'])
  pairs.push([`2. Run the read-only investigation it asks for (greps, reading tests). To OBSERVE tests, ${P31X.observeTests('the files the investigation targets (none when it targets no code)', '', V, slot)}\n`,
    `2. Run the read-only investigation it asks for (greps, reading tests, and a baseline verifier run to OBSERVE:\n   run it as \`${P31X.slotted(V, slot)}\` from the task tree).\n`, 'investigator'])
  pairs.push([`do not approve on faith.\nTests: you need not run any. To check a claim, ${P31X.observeTests('the files the plan names', '', V, slot)}\n`,
    'do not approve on faith.\n', 'plan judge'])
  pairs.push([`as needed.\nTests: to re-check a baseline or a claim, ${P31X.observeTests('the files your plan will change', '', V, slot)}\nRewrite the plan so that its\n`,
    'as needed. Rewrite the plan so that its\n', 'plan reviser'])
  pairs.push([`${P31X.slotRule(V, slot)}\n\nThe PR is authoritative`, '\n\nThe PR is authoritative', 'review judge slotRule'])
  pairs.push([`anywhere else.\n\n${P31X.reviewTests(V, slot, '')}\n\nRead \``, 'anywhere else.\n\nRead `', 'review judge tests'])
  return pairs
}
// A prompt with every p31-1 fragment swapped back for its old text.
const preP31 = (p, slot) => p31Pairs(slot).reduce((x, [nw, od]) => x.split(nw).join(od), p)
// The pairs no pinned call renders: the n=2 loops (a top-rung retry) and the one-shot (every pinned implementer runs
// on the top rung: proj-fix-p's plan judge climbs it there). They stay in p31Pairs for any other render, and the
// p31-1 block pins the one-shot against PRE_P31.oneShot; the pins block checks that every other pair renders.
const P31_MATRIX_ONLY = ['loop n=2', 'loop n=2 baseline', 'one-shot', 'one-shot baseline']
{
  const E = loadEngine(['ralphLoop', 'fullSuiteLoop', 'oneShotVerify', 'verifyBlock', 'baselineManifest', 'touchedOf', 'touchedTests',
    'observeTests', 'reviewTests', 'TREE_TIDY', 'integrationVerify', 'slotted', 'slotRule', 'slotNote', 'SLOT_TEXT', 'KILL_RULE', 'GIT_ENV_SCRUB',
    ...RULE_BUILDERS])
  const sha = (x) => crypto.createHash('sha256').update(x).digest('hex')
  const shaAll = (xs) => sha(xs.join('\n\0\n'))
  const times = (hay, needle) => hay.split(needle).length - 1
  const V = 'make test'
  const SLOT = VERIFY_SLOT
  const B = ['t — env']
  const PIN = 'tests/test_{module}.py'
  const CLAUSE = " the rollout's `touched:` pattern `tests/test_{module}.py`, with `{module}` replaced by each changed module's name; else"
  const NOTE_WRITE = 'Also append that diagnosis to the task note under a "## Blocker diagnosis" heading.'
  const ar = { repoPath: '/repo', verifier: V, rolloutSlug: 'r' }
  const argsOf = (b, s, over = {}) => ({ ...ar, ...(b ? { knownBaselineFailures: b } : {}), ...(s ? { verifySlot: s } : {}), ...over })
  const tk = { slug: 'proj-fix-x', taskPath: '/vault/proj-fix-x.md', maxIterations: 3, scope: 'cross-cutting' }
  const im = { prUrl: 'https://github.com/o/r/pull/1', worktreePath: '/repo/.claude/worktrees/proj-fix-x', branch: 'audit-fix/fix-x' }
  const hist = [{ round: 1, feedback: ['fix it'] }, { round: 2, feedback: ['keep theirs'], stage: 'integration' }]
  const stAt = (rung, stages) => {
    const st = E.rungState({ ...tk, rung }, {})
    for (const s of stages) E.escalate(st, tk.slug, s)
    return st
  }
  const ST = { bottom: stAt('opus-high', []), climbed: stAt('opus-high', ['implement']), top: stAt('opus-xhigh', ['implement']) }
  // Every task-call builder, as [name, variant, prompt]: the implementers on the bottom rung (one-shot), after a climb
  // and on the top rung; the reviser unseeded and seeded (COLD ENTRY); the review judge and the four tree agents.
  const taskCalls = (a) => [
    ...['bottom', 'climbed', 'top'].flatMap((k) => [
      ['implementerPrompt', k, E.implementerPrompt(tk, a, ST[k], '')],
      ['approvedPlanImplementerPrompt', k, E.approvedPlanImplementerPrompt(tk, 'PLAN', a, ST[k], '')],
    ]),
    ['reviserPrompt', 'r2', E.reviserPrompt(tk, im, hist.slice(0, 1), 2, a, '')],
    ['reviserPrompt', 'seeded', E.reviserPrompt(tk, im, hist, 3, a, '', { history: hist, roundsUsed: 2 })],
    ['reviewJudgePrompt', '', E.reviewJudgePrompt(tk, im, a, [])],
    ['plannerPrompt', '', E.plannerPrompt(tk, a, ST.bottom, '')],
    ['readOnlyPrompt', '', E.readOnlyPrompt(tk, a, ST.bottom, '')],
    ['planJudgePrompt', '', E.planJudgePrompt(tk, 'PLAN', a)],
    ['planReviserPrompt', '', E.planReviserPrompt(tk, 'PLAN', hist.slice(0, 1), 2, a)],
  ]
  const oneShotOf = (name, k) => k === 'bottom' && (name === 'implementerPrompt' || name === 'approvedPlanImplementerPrompt')

  // 3. Integration unchanged: its two agents hash to their pre-edit pins with args.touched unset, set and refused;
  // fullSuiteLoop is the old ralphLoop, preOneShot the old one-shot, and the integrator's manifest the old one.
  for (const touched of [undefined, PIN, 'make test {module}']) {
    const over = touched === undefined ? {} : { touched }
    const integ = []
    for (const b of [undefined, B]) for (const s of [undefined, SLOT]) integ.push(...agentPrompts(E, argsOf(b, s, over)).integratorPrompt)
    ok(integ.length === 8 && shaAll(integ.map(preP29)) === PRE_P31.integrator, `p31-1: integratorPrompt with the p29-9 block swapped out is its pre-p31-1 bytes (2 fixtures × baseline × slot), touched ${JSON.stringify(touched)}`)
    ok(shaAll(integ) === P29_PINS.integrator, `p29-9: integratorPrompt is the p29-9 base plus the Flake check block (2 fixtures × baseline × slot), touched ${JSON.stringify(touched)}`)
    ok(shaAll(agentPrompts(E, over).integrationReviewPrompt) === PRE_P31.integrationReview, `p31-1: integrationReviewPrompt is its pre-p31-1 bytes, touched ${JSON.stringify(touched)}`)
  }
  const loops = []
  for (const n of [2, 3]) for (const b of [undefined, B]) for (const s of [undefined, SLOT, { ...SLOT, priority: true }]) loops.push(E.fullSuiteLoop(V, n, b, s))
  ok(shaAll(loops) === PRE_P31.ralph, 'p31-1: fullSuiteLoop is the pre-p31-1 ralphLoop, byte for byte (12 renders)')
  const shots = []
  for (const b of [undefined, B]) for (const s of [undefined, SLOT]) shots.push(preOneShot(V, b, s))
  ok(shaAll(shots) === PRE_P31.oneShot, 'p31-1: preOneShot (the swap-back literal) is the pre-p31-1 oneShotVerify, byte for byte')
  const aB = argsOf(B)
  ok(sha(E.baselineManifest(aB, true)) === PRE_P31.manifest, "p31-1: baselineManifest(a, true), the integrator's, is its pre-p31-1 bytes")
  ok(E.baselineManifest(aB) !== E.baselineManifest(aB, true) && times(E.baselineManifest(aB), MANIFEST_P31[0]) === 1 &&
    E.baselineManifest(aB).split(MANIFEST_P31[0]).join(MANIFEST_P31[1]) === E.baselineManifest(aB, true),
  "p31-1: a task call's manifest is the integrator's with exactly the new tail (from any run, touched or full)")
  ok(E.baselineManifest(ar) === '' && E.baselineManifest(ar, true) === '' && E.baselineManifest(argsOf([]), true) === '', 'p31-1: the manifest is still empty without reds, in both arms')
  for (const a of [ar, aB, argsOf(undefined, SLOT), argsOf(B, SLOT, { touched: PIN })]) {
    const want = E.fullSuiteLoop(V, 3, a.knownBaselineFailures, a.verifySlot && { ...a.verifySlot, priority: true })
      .replace(NOTE_WRITE, 'Write nothing to the task note (the engine records the diagnosis), and push nothing.')
    ok(E.integrationVerify(tk, a) === want && !want.includes('Touched tests'), `p31-1: integrationVerify is fullSuiteLoop with the note write replaced (baseline ${!!a.knownBaselineFailures}, slot ${!!a.verifySlot}, touched ${!!a.touched})`)
  }

  // 1. Touched tests in every try: `- Touched tests:` before `- Verifier:`; the loop's step a runs the touched tests,
  // never the verifier, and step d keeps the note write coldEntryBlock overrides; the one-shot's `EXACTLY ONCE` twice,
  // and a red touched run skips the verifier. [] when the prompt holds; else what failed.
  const triesFail = (p, shot) => {
    const out = []
    const t = p.indexOf('\n- Touched tests: ')
    const v = p.indexOf('\n- Verifier: ')
    if (t < 0 || v < 0 || t > v) out.push('touched tests before the verifier')
    if (shot) {
      if (times(p, 'EXACTLY ONCE') !== 2) out.push('EXACTLY ONCE twice')
      if (!p.includes('- Run the touched tests EXACTLY ONCE. If they are green, run the verifier EXACTLY ONCE') ||
        !p.includes('if they are red, do NOT run the verifier.')) out.push('a red touched run skips the verifier')
    } else {
      if (!p.includes('\n  a. Run the touched tests, never the verifier here.\n')) out.push('step a: the touched tests, never the verifier')
      if (!p.includes(NOTE_WRITE)) out.push('step d: the note write')
    }
    return out
  }
  for (const b of [undefined, B]) for (const s of [undefined, SLOT]) {
    const a = argsOf(b, s)
    const coders = taskCalls(a).filter(([name]) => ['implementerPrompt', 'approvedPlanImplementerPrompt', 'reviserPrompt'].includes(name))
    ok(coders.length === 8 && coders.every(([name, k, p]) => triesFail(p, oneShotOf(name, k)).length === 0),
      `p31-1: every implementer, approved-plan implementer and reviser runs the touched tests in its tries (baseline ${!!b}, slot ${!!s})`)
    const seeded = coders.find(([, k]) => k === 'seeded')[2]
    ok(seeded.includes('COLD ENTRY') && seeded.includes("this overrides the verification loop's last step") && seeded.includes(NOTE_WRITE),
      "p31-1: the seeded reviser's COLD ENTRY still has step d's note write to override")
  }
  ok(triesFail(E.fullSuiteLoop(V, 3, undefined), false).length === 2 && triesFail(E.fullSuiteLoop(V, 3, B), false).length === 2,
    "p31-1 control: fullSuiteLoop's text fails the touched check (no touched tests, the verifier at step a)")
  {
    const p = E.implementerPrompt(tk, ar, ST.climbed, '')
    const spliced = p.replace(E.ralphLoop(V, 3, undefined, undefined, ''), E.fullSuiteLoop(V, 3, undefined))
    ok(spliced !== p && triesFail(spliced, false).length > 0, 'p31-1 control: an implementer with the old loop spliced in fails the touched check')
  }

  // 2. The verifier once, at the end: step b runs it only when the touched tests pass, as the last check before the
  // PR; the loop never renders `EXACTLY ONCE` and names one verifier run.
  const endFails = (loop) => {
    const out = []
    const ia = loop.indexOf('\n  a. Run the touched tests')
    const ib = loop.indexOf('\n  b. When they ')
    const ic = loop.indexOf('\n  c. On a ')
    if (!(ia > -1 && ib > ia && ic > ib)) out.push('steps a, b, c in order')
    else if (!/^\n {2}b\. When they (pass|are green), run the verifier ONCE, as your last check before you open or update the PR \(a\n {5}Checkpoint, estate ADR 0009 d1\)\./.test(loop.slice(ib, ic))) {
      out.push('step b: the verifier once, when the touched tests pass, as the check before the PR')
    }
    if (loop.includes('EXACTLY ONCE') || loop.includes('ONE-SHOT')) out.push('no one-shot marker')
    if (times(loop, 'run the verifier') !== 1) out.push('one verifier step')
    return out
  }
  const ends = []
  for (const n of [1, 2, 3]) for (const b of [undefined, [], B]) for (const s of [undefined, SLOT]) for (const t of [undefined, '', PIN]) ends.push(...endFails(E.ralphLoop(V, n, b, s, t)))
  ok(ends.length === 0, 'p31-1: in every ralphLoop render the verifier runs once, only when the touched tests pass, as the check before the PR')
  ok(endFails(E.fullSuiteLoop(V, 3, undefined)).length > 0 && endFails(E.fullSuiteLoop(V, 3, B)).length > 0, 'p31-1 control: fullSuiteLoop fails the verifier-at-the-end check')

  // 4. touchedOf, touchedTests and observeTests.
  for (const g of [PIN, 'skills/{module}/tests/*.test.mjs', 'src/{module}/__tests__/{module}.test.ts', 'pkg/{module}/{module}_test.go',
    'test/[a-z]*/{module}.spec.js', '@scope/{module}/t?st/a+b,c=1:2~3.js', '{module}', 'x'.repeat(192) + '{module}',
    'tests/unit-{module}-test.py', 'tests/{module}--x.py']) {
    ok(E.touchedOf({ touched: g }) === g, `touchedOf: accepts ${JSON.stringify(g.length > 40 ? g.slice(0, 12) + '…' : g)} (${g.length} chars)`)
  }
  for (const [what, v] of [['an object (unquoted YAML {module})', { module: null }], ['a number', 7], ['an array', [PIN]], ['null', null],
    ['undefined', undefined], ['empty', ''], ['no {module}', 'tests/test_x.py'], ['a space', 'tests/test {module}.py'], ['a command', 'make test {module}'],
    ['a tab', 'tests/\t{module}.py'], ['a single quote', "tests/'{module}'.py"], ['a double quote', 'tests/"{module}".py'], ['a $', '$HOME/{module}.py'],
    ['a $(…)', 'tests/$(x){module}'], ['a ;', 'tests/{module}.py;rm'], ['a |', 'tests/{module}.py|x'], ['a &', 'tests/{module}.py&x'],
    ['a backslash', 'tests\\{module}.py'], ['a backtick', 'tests/`{module}`.py'], ['a newline', 'tests/{module}.py\nx'], ['a trailing newline', PIN + '\n'],
    ['a NUL', 'tests/{module}\u0000.py'], ['a DEL', 'tests/{module}\u007f.py'], ['201 characters', 'x'.repeat(193) + '{module}'],
    ['a runner option that hides failures (--deselect={module})', '--deselect={module}'], ['a runner option (-k{module})', '-k{module}'],
    ['a leading -', '-tests/{module}.py']]) {
    ok(E.touchedOf({ touched: v }) === '', `touchedOf: refuses ${what}`)
  }
  ok(E.touchedOf(undefined) === '' && E.touchedOf(null) === '' && E.touchedOf({}) === '', 'touchedOf: no args.touched ⇒ ""')
  const F = 'the files your diff changes, plus any test file you add or edit'
  const t0 = E.touchedTests('', F)
  const t1 = E.touchedTests(PIN, F)
  ok(times(t1, CLAUSE) === 1 && t1.split(CLAUSE).join('') === t0 && E.touchedTests(undefined, F) === t0,
    'touchedTests: the pinned text is the unpinned one plus exactly the pin clause, the pattern in a code span')
  ok(!t0.includes('\n') && t0.startsWith(`the test files that reach ${F}.`) && t0.includes("the Tests line of the repo's own `CLAUDE.md` or `AGENTS.md`") &&
    t0.includes(`\`${E.GIT_ENV_SCRUB} git grep -l '<module or file name>'\``) && t0.includes('never the verifier line, and never the whole suite under another command') &&
    t0.includes('(a docs-only change), there are none'), 'touchedTests: one line; the repo Tests line, else a scrubbed git grep; never the verifier or the whole suite; none for a docs-only change')
  ok(t1.indexOf('`touched:`') < t1.indexOf('the Tests line') && t1.indexOf('the Tests line') < t1.indexOf('git grep'), 'touchedTests: the sources in order: the pin, the repo Tests line, the imports')
  // The repo's Tests line applies only when it runs one file's or module's tests; a full-suite-only line (most repos'
  // `Tests: make test`) falls through to the git grep, so "the first source that applies" never meets "never the
  // whole suite under another command".
  const TESTS_LINE = "the Tests line of the repo's own `CLAUDE.md` or `AGENTS.md`, which applies only when it says how to run one file's or one module's tests (a Tests line that names only the whole suite's command does not apply: fall through to the next source); else the test files that import or name each file"
  for (const t of [t0, t1]) {
    ok(times(t, TESTS_LINE) === 1 && t.indexOf(TESTS_LINE) < t.indexOf('git grep') && t.indexOf(TESTS_LINE) < t.indexOf('never the whole suite under another command'),
      `touchedTests: a Tests line applies only when it runs one file's or module's tests; a full-suite-only line falls through to the git grep (pin ${t === t1})`)
  }
  const TIDY_SPAN = `\`${E.GIT_ENV_SCRUB} git -C "<task tree>" status --porcelain\``
  ok(E.TREE_TIDY.startsWith(`take ${TIDY_SPAN} (the \`Task tree:\` path above) immediately before and immediately after it, then revert only the tracked changes`) &&
    E.TREE_TIDY.endsWith('that appear in the after list but not the before list.') && !E.TREE_TIDY.includes('\n') && !E.TREE_TIDY.includes('rule (iii)'),
  'TREE_TIDY: one line, the scrubbed before/after status diff, named outright (never by rule (iii))')
  for (const s of [undefined, SLOT]) for (const t of ['', PIN]) {
    const o = E.observeTests('the files the plan names', t, V, s)
    ok(!o.includes(E.SLOT_TEXT) && !/EXACTLY ONCE|ONE-SHOT|Max iterations/.test(o) && times(o, E.slotted(V, s)) === 1 &&
      o.startsWith(`run only the touched tests: ${E.touchedTests(t, 'the files the plan names')} Run them at most once, write no fix code`) &&
      o.endsWith(`run the verifier (\`${E.slotted(V, s)}\`) only when the task brief asks for a full-suite baseline.`),
    `observeTests: touched tests, then the verifier only when the brief asks; no SLOT_TEXT and no one-shot or loop marker (slot ${!!s}, pin ${!!t})`)
    // The tidy is named outright for every run, the touched tests included, never left to rule (iii) (the verifier's).
    ok(times(o, E.TREE_TIDY) === 1 && o.includes(`tidy after each run of yours, the touched tests or the verifier: ${E.TREE_TIDY}`) && !o.includes('rule (iii)') &&
      !o.includes('\n'), `observeTests: one line; it names the before/after status diff for each run, the touched tests or the verifier (slot ${!!s}, pin ${!!t})`)
  }
  const pinned = taskCalls(argsOf(undefined, undefined, { touched: PIN }))
  ok(pinned.length === 13 && pinned.every(([, , p]) => times(p, CLAUSE) === 1), 'p31-1: args.touched reaches every task-call builder, once')
  ok(taskCalls(ar).every(([, , p]) => !p.includes('`touched:`')), 'p31-1: no task-call builder names a pin when args.touched is unset')
  const integPinned = agentPrompts(E, { touched: PIN })
  ok([...integPinned.integratorPrompt, ...integPinned.integrationReviewPrompt].every((p) => !p.includes('`touched:`') && !p.includes('Touched tests')), "p31-1: Integration's prompts never read args.touched")

  // 5. The review judge: slotRule right after KILL_RULE; the tests block runs touched tests only, its tidy span is
  // scrubbed, and its one verifier line outside slotRule sits in the only-when-asked clause. Both runs are bound to the
  // read rule: with no usable tree (a mismatch, a non-empty status, a missing tree) the judge runs no tests at all,
  // never in the shared checkout, and says so in its feedback; with one, each run is in the task tree, inside the
  // before/after status diff.
  const NO_TREE = "When the read rule above fails (a mismatch, a non-empty status or a missing\ntree), run no tests at all, neither the touched tests nor the verifier, and never in the project's shared checkout\nor anywhere else: say in your feedback that you ran none, and why."
  const IN_TREE = 'When it holds, run tests only in the task tree. To check a claim, run only the touched tests: '
  const READ_RULE = 'On a mismatch, a non-empty status or a missing tree, use `gh pr diff` / `gh pr view` only'
  // [] when the review judge binds every test run to its read rule; else what failed.
  const noTreeFails = (p, s) => {
    const out = []
    const line = E.slotted(V, s)
    const verifierClause = `Never run the verifier unless the task brief asks the review for the full suite; then run exactly\n\`${line}\`, once.`
    const tidy = `Tidy after each run, the touched tests or the verifier: ${E.TREE_TIDY}`
    const at = (x) => p.indexOf(x)
    if (times(p, NO_TREE) !== 1) out.push('no tree: no tests at all, never the shared checkout, said in the feedback')
    if (times(p, IN_TREE) !== 1) out.push('a tree: the touched tests only in the task tree')
    if (times(p, tidy) !== 1) out.push('the tidy covers both runs')
    if (!(at(READ_RULE) > -1 && at(READ_RULE) < at(NO_TREE) && at(NO_TREE) < at(IN_TREE) && at(IN_TREE) < at(verifierClause) && at(verifierClause) < at(tidy))) {
      out.push('in order: the read rule, no tree, the touched tests, the verifier, the tidy')
    }
    if (p.includes('Run them in the task tree only when')) out.push('no conditional run wording')
    return out
  }
  for (const b of [undefined, B]) for (const s of [undefined, SLOT]) for (const t of [undefined, PIN]) {
    const p = E.reviewJudgePrompt(tk, im, argsOf(b, s, t ? { touched: t } : {}), [])
    const rule = E.slotRule(V, s)
    const line = E.slotted(V, s)
    const outside = p.split(rule).join('')
    const at = `baseline ${!!b}, slot ${!!s}, pin ${!!t}`
    ok(p.includes(E.KILL_RULE + rule + '\n\nThe PR is authoritative'), `p31-1: the review judge carries slotRule right after KILL_RULE (${at})`)
    ok(p.includes(`anywhere else.\n\n${E.reviewTests(V, s, t || '')}\n\nRead \``) && p.includes('To check a claim, run only the touched tests: '),
      `p31-1: the review judge's tests block follows its read-only paragraph and runs touched tests only (${at})`)
    ok(times(outside, line) === 1 && outside.includes(`Never run the verifier unless the task brief asks the review for the full suite; then run exactly\n\`${line}\`, once.`),
      `p31-1: the review judge's only verifier line outside slotRule is the only-when-asked clause (${at})`)
    ok(E.reviewTests(V, s, '').includes(`\`${E.GIT_ENV_SCRUB} git -C "<task tree>" status --porcelain\``) && !E.reviewTests(V, s, '').includes(E.SLOT_TEXT),
      `p31-1: the review judge's before/after tidy span is scrubbed, and its tests block holds no SLOT_TEXT (${at})`)
    ok(JSON.stringify(noTreeFails(p, s)) === '[]',
      `p31-1: with no usable tree the review judge runs no tests at all (never the shared checkout) and says so; with one, both runs are in the task tree, inside the before/after diff (${at})`)
  }
  // controls: the gate taken out, and the round-1 block (a conditional touched run, the verifier unbound), each fail
  {
    const p = E.reviewJudgePrompt(tk, im, argsOf(undefined, SLOT), [])
    ok(p.includes(NO_TREE) && noTreeFails(p.replace(NO_TREE + '\n', ''), SLOT).includes('no tree: no tests at all, never the shared checkout, said in the feedback'),
      'p31-1 control: a review judge without the no-tree sentence fails the no-tree check')
    const line = E.slotted(V, SLOT)
    const round1 = `Tests: you need not run any. The implementer ran the verifier at its Checkpoint, and Integration runs it again
before the merge (estate ADR 0009 d1). To check a claim, run only the touched tests: ${E.touchedTests('', 'the files the PR diff changes')}
Run them in the task tree only when the read rule above lets you read it there: take
\`${E.GIT_ENV_SCRUB} git -C "<task tree>" status --porcelain\` (the \`Task tree:\` path above) immediately before and
immediately after the run, then revert only the tracked changes, and delete only the untracked paths, that appear
in the after list but not the before list.
Never run the verifier unless the task brief asks the review for the full suite; then run exactly
\`${line}\`, once.`
    const old = p.replace(E.reviewTests(V, SLOT, ''), round1)
    ok(old !== p && noTreeFails(old, SLOT).length >= 4, 'p31-1 control: the round-1 tests block (a conditional touched run, the verifier unbound) fails the no-tree check')
  }

  // 6. The four TASK_TREE_RULE agents observe with observeTests over their own files: one verifier line outside
  // slotRule, in the only-when-asked clause; slotRule still right after KILL_RULE; no old observe-with-the-verifier text.
  const TREE_FILES = {
    plannerPrompt: 'the files the plan will change', readOnlyPrompt: 'the files the investigation targets (none when it targets no code)',
    planJudgePrompt: 'the files the plan names', planReviserPrompt: 'the files your plan will change',
  }
  for (const s of [undefined, SLOT]) for (const t of [undefined, PIN]) {
    const byName = Object.fromEntries(taskCalls(argsOf(undefined, s, t ? { touched: t } : {})).map(([name, , p]) => [name, p]))
    const rule = E.slotRule(V, s)
    const line = E.slotted(V, s)
    for (const [name, files] of Object.entries(TREE_FILES)) {
      const p = byName[name]
      const outside = p.split(rule).join('')
      ok(p.includes(E.observeTests(files, t || '', V, s)) && times(outside, line) === 1 &&
        outside.includes(`run the verifier (\`${line}\`) only when the task brief asks for a full-suite baseline`) && p.includes(E.KILL_RULE + rule) &&
        !p.includes('run the verifier ONCE') && !p.includes('a baseline verifier run'),
      `p31-1: ${name} observes with its own touched tests, the verifier only when the brief asks, slotRule after KILL_RULE (slot ${!!s}, pin ${!!t})`)
    }
  }

  // 7. The full-verifier sweep over every task-call builder × baseline × slot. Code-writers render exactly one
  // verifier line, the `- Verifier:` line; the review judge and the tree agents exactly one outside slotRule, in their
  // only-when-asked clause; no task call says "full verifier" or "Keep running"; a baseline manifest rules out
  // skipping the reds from any run, touched or full; only the bottom-rung implementers render the one-shot.
  const ROLE = {
    implementerPrompt: 'coder', approvedPlanImplementerPrompt: 'coder', reviserPrompt: 'coder', reviewJudgePrompt: 'judge',
    plannerPrompt: 'tree', readOnlyPrompt: 'tree', planJudgePrompt: 'tree', planReviserPrompt: 'tree',
  }
  const MANIFESTED = ['implementerPrompt', 'approvedPlanImplementerPrompt', 'reviserPrompt', 'reviewJudgePrompt', 'plannerPrompt', 'readOnlyPrompt']
  // [] when every prompt holds; else `<check>: <name> <variant>`.
  const sweepFails = (entries, a) => {
    const out = []
    const line = E.slotted(V, a.verifySlot)
    const rule = E.slotRule(V, a.verifySlot)
    const based = !!(a.knownBaselineFailures && a.knownBaselineFailures.length)
    for (const [name, k, p] of entries) {
      const at = k ? `${name} ${k}` : name
      if (/full verifier/i.test(p) || p.includes('Keep running')) out.push(`full verifier: ${at}`)
      if (based && MANIFESTED.includes(name) && !p.includes('from any run, touched or full')) out.push(`manifest: ${at}`)
      if (ROLE[name] === 'coder') {
        const lines = p.split('\n').filter((l) => l.includes(line))
        if (times(p, line) !== 1 || lines.length !== 1 || lines[0] !== `- Verifier: ${line}`) out.push(`verifier lines: ${at}`)
      } else if (ROLE[name]) {
        const outside = p.split(rule).join('')
        const clause = ROLE[name] === 'judge'
          ? `Never run the verifier unless the task brief asks the review for the full suite; then run exactly\n\`${line}\`, once.`
          : `run the verifier (\`${line}\`) only when the task brief asks for a full-suite baseline`
        if (times(outside, line) !== 1 || !outside.includes(clause)) out.push(`verifier lines: ${at}`)
      }
      const marked = p.includes('EXACTLY ONCE') || p.includes('ONE-SHOT')
      if (oneShotOf(name, k) ? !(p.includes('EXACTLY ONCE') && p.includes('ONE-SHOT')) : marked) out.push(`one-shot: ${at}`)
    }
    return out
  }
  for (const b of [undefined, B]) for (const s of [undefined, SLOT]) {
    const a = argsOf(b, s)
    const entries = taskCalls(a)
    ok(entries.length === 13 && JSON.stringify(sweepFails(entries, a)) === '[]',
      `p31-1 sweep: every task call runs the verifier only at its Checkpoint or when asked, and never says "full verifier" (baseline ${!!b}, slot ${!!s})`)
  }
  // controls: each fails exactly its check
  ok(JSON.stringify(sweepFails([['integratorPrompt', '', agentPrompts(E, { knownBaselineFailures: B }).integratorPrompt[0]]], aB)) === '["full verifier: integratorPrompt"]',
    'p31-1 sweep control: the integrator with a baseline still says "Keep running the full verifier", and fails')
  {
    const p = E.implementerPrompt(tk, aB, ST.top, '')
    const spliced = p.replace(E.ralphLoop(V, 3, B, undefined, ''), E.fullSuiteLoop(V, 3, B))
    ok(spliced !== p && JSON.stringify(sweepFails([['implementerPrompt', 'top', spliced]], aB)) === '["full verifier: implementerPrompt top"]',
      "p31-1 sweep control: a prompt with fullSuiteLoop's baseline text spliced in fails the full-verifier check")
    const planner = E.plannerPrompt(tk, aB, ST.bottom, '')
    const [newBullet, oldBullet] = p31Pairs(undefined).find(([, , label]) => label === 'planner')
    const old = planner.replace(newBullet, oldBullet)
    ok(old !== planner && JSON.stringify(sweepFails([['plannerPrompt', '', old]], aB)) === '["verifier lines: plannerPrompt"]',
      'p31-1 sweep control: a planner with the old run-the-verifier-ONCE bullet fails the verifier-line check')
  }

  // 8. runTask: a refused args.touched is logged once and read as absent (the call still dispatches); a good one reaches
  // the implementer; integrate mode neither reads nor logs it.
  const LADDER1 = { source: 'built-in', rungs: [{ name: 'opus-high', model: 'opus', effort: 'high', judge: 'high', review: 'xhigh' }] }
  const mkRun = (over = {}) => ({
    rolloutSlug: 'r', repoPath: '/repo', verifier: V, date: '2026-10-26', ladder: LADDER1, verifySlot: SLOT,
    task: { slug: 'proj-fix-x', taskPath: '/vault/proj-fix-x.md', scope: 'single-file', planGate: false, maxIterations: 3, maxReviewRounds: 3, maxPlanRounds: 3 },
    ...over,
  })
  const green = async (prompt, opts) => opts.label.startsWith('review:')
    ? { verdict: 'approve', feedback: [] }
    : { verified: true, blocked: false, escalate: false, prUrl: im.prUrl, branch: im.branch, worktreePath: im.worktreePath, blockerDiagnosis: '', summary: 's' }
  const REFUSED = /^touched: refusing .+ — the rollout's touched-tests pattern is off for this call \(estate ADR 0009 d1\)$/
  const plain = await runTask(mkRun(), green)
  const implOf = (r) => r.calls.find((c) => c.label.startsWith('implement:'))
  ok(!plain.error && implOf(plain) && plain.logs.every((l) => !l.startsWith('touched:')), 'runTask: no args.touched ⇒ no touched log line')
  for (const [what, v] of [['an object', { module: null }], ['no {module}', 'tests/test_x.py'], ['a command', 'make test {module}'], ['a backtick', 'tests/`{module}`.py'],
    ['a runner option that hides failures', '--deselect={module}'], ['a runner option', '-k{module}']]) {
    const r = await runTask(mkRun({ touched: v }), green)
    ok(!r.error && r.logs.filter((l) => REFUSED.test(l)).length === 1 && r.logs.filter((l) => l.startsWith('touched:')).length === 1 &&
      implOf(r) && JSON.stringify(r.calls) === JSON.stringify(plain.calls),
    `runTask: a refused touched (${what}) is logged once and read as absent; the call still dispatches`)
  }
  const pinnedRun = await runTask(mkRun({ touched: PIN }), green)
  ok(!pinnedRun.error && pinnedRun.logs.every((l) => !l.startsWith('touched:')) && implOf(pinnedRun).prompt.includes(CLAUSE) &&
    pinnedRun.calls.find((c) => c.label.startsWith('review:')).prompt.includes(CLAUSE), 'runTask: a good touched reaches the implementer and the review judge, unlogged')
  const H = (c) => c.repeat(40)
  const I = {
    prUrl: im.prUrl, branch: im.branch, worktreePath: im.worktreePath, headSha: H('a'), taskBase: H('b'), mainSha: H('c'), trouble: ['conflict'],
    landed: [], reviewHistory: [{ round: 1, feedback: ['fix it'] }], reviewRoundsUsed: 1,
    rung: { startRung: 'opus-high', rung: 'opus-high', climbs: [] }, startedAt: '2026-10-26T10:00:00Z',
  }
  const integrate = (over) => runTask(mkRun({ mode: 'integrate', integration: I, ...over }), async () => { throw new Error('stub') })
  const i0 = await integrate({})
  for (const v of [PIN, 'make test {module}', { module: null }]) {
    const r = await integrate({ touched: v })
    ok(i0.calls.length > 0 && JSON.stringify(r.calls) === JSON.stringify(i0.calls) && JSON.stringify(r.logs) === JSON.stringify(i0.logs),
      `runTask (integrate mode): prompts and logs are unchanged with touched ${JSON.stringify(v)}`)
  }
}

// ---- The Flake check (p29-9, ADR 0050) ----------------------------------------------------------------------------
// FLAKE_CHECK_TASK renders exactly once in every implementer (bottom, climbed, top), approved-plan implementer and
// reviser (unseeded and seeded), right after its verification block; FLAKE_CHECK_INTEGRATION once in the integrator,
// right after integrationVerify. Neither renders in any other prompt. Both are static: no verifier line, no `run the
// verifier`, `EXACTLY ONCE`, `ONE-SHOT`, `Max iterations` or `Touched tests`, one scrubbed git span, and both say never
// fix a Flake. [] when every prompt holds; else what failed.
{
  const E = loadEngine(['implementerPrompt', 'approvedPlanImplementerPrompt', 'reviserPrompt', 'reviewJudgePrompt', 'plannerPrompt',
    'readOnlyPrompt', 'planJudgePrompt', 'planReviserPrompt', 'integratorPrompt', 'integrationReviewPrompt', 'verifyBlock', 'ralphLoop',
    'integrationVerify', 'touchedOf', 'rungState', 'escalate', 'FLAKE_CHECK_TASK', 'FLAKE_CHECK_INTEGRATION', 'flakeCheck', 'GIT_ENV_SCRUB',
    'DIFF_FILES', 'slotted'])
  const TB = E.FLAKE_CHECK_TASK
  const IB = E.FLAKE_CHECK_INTEGRATION
  const times = (hay, needle) => hay.split(needle).length - 1
  const tk = { slug: 'proj-fix-x', taskPath: '/vault/proj-fix-x.md', maxIterations: 3, scope: 'cross-cutting' }
  const im = { prUrl: 'https://github.com/o/r/pull/1', worktreePath: '/repo/.claude/worktrees/proj-fix-x', branch: 'audit-fix/fix-x' }
  const hist = [{ round: 1, feedback: ['fix it'] }, { round: 2, feedback: ['keep theirs'], stage: 'integration' }]
  const stAt = (rung, stages) => {
    const st = E.rungState({ ...tk, rung }, {})
    for (const s of stages) E.escalate(st, tk.slug, s)
    return st
  }
  const ST = { bottom: stAt('opus-high', []), climbed: stAt('opus-high', ['implement']), top: stAt('opus-xhigh', ['implement']) }
  const blockFails = (b) => {
    const out = []
    for (const s of ['run the verifier', 'EXACTLY ONCE', 'ONE-SHOT', 'Max iterations', 'Touched tests', '`touched:`', 'Keep running']) {
      if (b.includes(s)) out.push(`no ${s}`)
    }
    if (/full verifier/i.test(b)) out.push('no full verifier')
    const spans = [...b.matchAll(/`([^`\n]*)`/g)].map((m) => m[1]).filter((x) => /(^|[\s;&|(])git\s/.test(x))
    if (spans.length !== 1 || !spans[0].startsWith(E.GIT_ENV_SCRUB)) out.push('one scrubbed git span')
    if (!b.includes('Never fix a Flake inside this task')) out.push('never fix a Flake')
    if (!b.includes('re-run only those named tests') || !b.includes('run the same verifier line above once more')) out.push('the named re-run, then one more run')
    if (!b.includes('never count as an iteration or as a second one-shot try')) out.push('the re-runs are the try\'s own')
    if (!b.includes('`flakes`')) out.push('returned in flakes')
    return out
  }
  ok(JSON.stringify(blockFails(TB)) === '[]' && JSON.stringify(blockFails(IB)) === '[]', 'p29-9: both Flake check blocks are static, scrubbed, never a one-shot or loop marker, and say never fix a Flake')
  ok(TB.includes(E.DIFF_FILES) && IB.includes("the merge step's `task file:` lines, plus every file your resolution and fix commits change") && TB === E.flakeCheck(E.DIFF_FILES),
    'p29-9: the task block reads the diff as the code-writers\' files, the integration block as the merge step\'s task files and its own commits')
  ok(JSON.stringify(blockFails(TB.replace('Never fix a Flake inside this task', 'Fix it'))) === '["never fix a Flake"]' &&
    blockFails(TB + '\nrun the verifier ONE-SHOT').length === 2, 'p29-9 control: a block without the rule, or with a marker, fails')
  for (const b of [undefined, ['t — env']]) for (const s of [undefined, VERIFY_SLOT]) {
    const a = { repoPath: '/repo', verifier: 'make test', rolloutSlug: 'r', ...(b ? { knownBaselineFailures: b } : {}), ...(s ? { verifySlot: s } : {}) }
    const coders = [
      ...['bottom', 'climbed', 'top'].flatMap((k) => [
        [`implementerPrompt ${k}`, E.implementerPrompt(tk, a, ST[k], ''), E.verifyBlock(ST[k], 'make test', 3, b, s, '')],
        [`approvedPlanImplementerPrompt ${k}`, E.approvedPlanImplementerPrompt(tk, 'PLAN', a, ST[k], ''), E.verifyBlock(ST[k], 'make test', 3, b, s, '')],
      ]),
      ['reviserPrompt r2', E.reviserPrompt(tk, im, hist.slice(0, 1), 2, a, ''), E.ralphLoop('make test', 3, b, s, '')],
      ['reviserPrompt seeded', E.reviserPrompt(tk, im, hist, 3, a, '', { history: hist, roundsUsed: 2 }), E.ralphLoop('make test', 3, b, s, '')],
    ]
    const at = `baseline ${!!b}, slot ${!!s}`
    ok(coders.every(([, p, v]) => times(p, TB) === 1 && times(p, v + '\n' + TB) === 1 && !p.includes(IB)),
      `p29-9: every implementer, approved-plan implementer and reviser renders the task block once, right after its verification block (${at})`)
    const I = { prUrl: im.prUrl, branch: im.branch, worktreePath: im.worktreePath, headSha: 'a'.repeat(40), taskBase: 'b'.repeat(40), mainSha: 'c'.repeat(40),
      trouble: ['red'], landed: [], reviewHistory: [], reviewRoundsUsed: 1, rung: { startRung: '', rung: '', climbs: [] } }
    const ip = E.integratorPrompt({ ...tk, approvedGates: [] }, a, I)
    ok(times(ip, IB) === 1 && times(ip, E.integrationVerify(tk, a) + '\n' + IB + '\nA verifier still red when the loop ends') === 1 && !ip.includes(TB),
      `p29-9: the integrator renders the integration block once, right after integrationVerify (${at})`)
    const J = { mergeCommit: 'd'.repeat(40), headSha: 'e'.repeat(40), baseSha: 'c'.repeat(40), triggers: ['conflict'], path: 'integrator' }
    const others = [E.reviewJudgePrompt(tk, im, a, []), E.plannerPrompt(tk, a, ST.bottom, ''), E.readOnlyPrompt(tk, a, ST.bottom, ''),
      E.planJudgePrompt(tk, 'PLAN', a), E.planReviserPrompt(tk, 'PLAN', hist.slice(0, 1), 2, a), E.integrationReviewPrompt(tk, a, I, J)]
    ok(others.every((p) => !p.includes('Flake check') && !p.includes(TB) && !p.includes(IB)),
      `p29-9: no planner, plan judge, plan reviser, investigator, review judge or Integration judge renders a Flake check (${at})`)
    ok(ip.includes(E.slotted('make test', s ? { ...s, priority: true } : s)) && times(ip, E.slotted('make test', s ? { ...s, priority: true } : s)) === 1,
      `p29-9: the integrator still renders its verifier line once (the block names it without rendering it) (${at})`)
  }
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
// Re-pinned on purpose by p14-2: the rows hash only, for the row's `plan` (proj-fix-p and proj-audit-x carry
// PLAN_TEXT, proj-fix-a ''). Those rows with `plan` deleted hash to the p13-2 pin (a0fc1e71…); the calls
// hash did not move — no task-mode prompt changed (the integrator wording is integrate mode, pinned by b4/b4b).
// Re-pinned on purpose by p16-3, both hashes: NEEDS_HUMAN_RULE ends the implementer, investigator and judge
// prompts, and every row carries `needsHuman`. The calls with the rule removed from each prompt hash to the old
// calls pin (ee821ac6…), so each prompt is its old bytes plus exactly the rule; the rows with `needsHuman`
// deleted hash to the old rows pin (0b7fa853…). taskTreeSetup and both reviser pins did not move.
// This is a deliberate resume-cache break, against the brief's "keep prompts byte-identical when it is absent":
// needsHuman is an output, so no prompt can depend on its absence, and agent() opts are part of the cache key
// (the archived quirk from when `model` joined the opts). The needsHuman field on PLAN_JUDGE, REVIEW_VERDICT and
// IMPL_RESULT already changes the opts (`schema`) of exactly the calls that render the rule (and the reviser's),
// so a pre-p16-3 run resumed on this engine misses the cache on those calls whatever their prompt bytes; the
// static rule adds no new break. Every other call keeps its bytes and its opts.
// Re-pinned on purpose by p18-1, the reviser pins and the calls hash: KILL_RULE (the 2026-10-04 incident) follows
// RM_RULE in every agent prompt. Each prompt is its old bytes plus exactly the rule: the revisers with it removed hash
// to their old pins (0f7eca82…, 00eb424a…), the calls with it removed to the p16-3 calls pin (8236605f…, the p18-1
// base), and with both rules removed to the p16-3 base (ee821ac6…). The rows, taskTreeSetup and the default-branch
// GOLDENs did not move. Like RM_RULE (p12-12), a deliberate resume-cache break: every agent prompt gains the rule,
// and a resume re-passes its run's own version-keyed `scriptPath`, so a call launched on an older engine replays there.
// Re-pinned on purpose by p21-3, the rows hash only: every row carries `reviewVerdicts`, each master-review round
// the call judged ({round, verdict, head, feedback}; proj-fix-p and proj-fix-a carry r1 and r2 `changes` with their
// one `fix review:<slug> rN` bullet and r3 `approve`, all head ''; the read-only proj-audit-x carries []). The rows
// with `reviewVerdicts` deleted hash to the p18-1 rows pin (7a9ecf48…, the p21-3 base), and with `needsHuman` deleted
// too to the p16-3 base (0b7fa853…). The calls hash did not move: no prompt byte changed (head and the `path:line`
// lead ride on REVIEW_VERDICT's descriptions alone), and runTask records only {label, prompt}. The schema change
// does move the review judge's opts (`schema`), so a pre-p21-3 run resumed on this engine misses the cache on its
// review calls: the same accepted break as p16-3's needsHuman field.
// Re-pinned on purpose by p23-1 (ADR 0038, a Cap is a promise), the reviser pins and the calls hash: the planner's and
// the plan reviser's Gated inputs lines teach the one-line `cap N USD` gate with its split in nested sub-bullets, the
// plan judge's checklist bullet allows those sub-bullets, and GATED_INPUTS_CHECK (implementer, approved-plan
// implementer, reviser) gives the same example. Each prompt is its old bytes plus exactly these edits: P23_1 holds
// each [new, old] fragment, and the calls and revisers with every new fragment swapped back hash to the p18-1 pins
// (1e51b62c…, 7c82d98a…, 7cf123a5…), which then chain to the older bases as before. No gatePricer is passed, so the
// judge's pricing fragment renders '' and its schema stays PLAN_JUDGE. The rows hash did not move (no row field
// changed, and no log line of these calls names ADR 0038); taskTreeSetup and the default-branch GOLDENs read none of
// these fragments. Like KILL_RULE, a deliberate resume-cache break: a resume re-passes its run's own `scriptPath`.
// Re-pinned on purpose by p31-1 (estate ADR 0009 d1: the full suite is a Checkpoint), the reviser pins, the calls hash
// and the slotted calls hash: each Ralph try runs the touched tests and the verifier once, before the PR; the one-shot
// runs the verifier only when the touched tests are green; the task calls' manifest rules out skipping the reds from
// any run, touched or full; the planner, investigator, plan judge and plan reviser observe with touched tests; and the
// review judge gains slotRule and a tests block. p31Pairs (above, by slot state) holds each [new, old] fragment: the
// calls and revisers with every new fragment swapped back hash to the p23-1 pins (4f524ab6…, 986d4024… slotted,
// c3efcd93…, 97ff33a1…), and every older base chains on top of that. The rows, taskTreeSetup and the default-branch
// GOLDENs did not move. A deliberate resume-cache break, like p23-1's: every task-call prompt changed, and so did
// IMPL_RESULT's escalate description (those calls' opts); a resume re-passes its run's own `scriptPath` (ADR 0043).
// Re-pinned again in p31-1's review round (the same four pins, through p31Pairs as before): touchedTests says a repo
// Tests line applies only when it runs one file's or module's tests (a full-suite-only line falls through to the git
// grep), observeTests names the before/after status diff (TREE_TIDY) instead of pointing at rule (iii), and the review
// judge binds both its runs to its read rule (no usable tree: no tests at all, said in the feedback). Every changed
// byte is inside a p31-1 fragment: the p31-1 base pins (4f524ab6…, 986d4024…, c3efcd93…, 97ff33a1…) did not move.
// Re-pinned on purpose by p29-9 (ADR 0050, the Flake check), the reviser pins, the calls hash, the slotted calls hash and
// the rows hash: FLAKE_CHECK_TASK follows each code-writing prompt's verification block, and every row carries `flakes`.
// P29_9 (above) swaps the block out first: the revisers, the calls and the slotted calls with it swapped out hash to the
// p31-1 pins (7b6822e4…, 4ff225d5…, b82f1748…, deac8755…), and every older base chains on top of that; the rows with
// `flakes` deleted hash to the p21-3 rows pin (0137cf70…). The integrator, which p31-1 left at its pre-p31-1 bytes, gains
// FLAKE_CHECK_INTEGRATION after integrationVerify: with it swapped out it is still PRE_P31.integrator. taskTreeSetup and
// the default-branch GOLDENs did not move. A deliberate resume-cache break, like p31-1's: every code-writing prompt and
// both result schemas (IMPL_RESULT, INTEGRATE_RESULT gain `flakes`) changed; a resume re-passes its run's own
// `scriptPath` (ADR 0043).
const P23_1 = [ // [new, old]
  ["   ### Gated inputs      (REQUIRED — one markdown bullet (\"- \") at column 0 per human authorisation the task\n                          needs: \"- spend: <what> — cap N USD\" (a hard cap is mandatory: ONE line whose Cap\n                          holds the whole spend, optionally with \"total\", a month, or \"per Login per month\n                          across K Logins\"), \"- credential: <what>\", \"- irreversible: <what>\"; or exactly\n                          \"None\". BULLETS ONLY — no prose or footnotes in this section: the engine reads only\n                          list lines, and anything else is rejected. How a spend splits (run counts, per-call\n                          limits, iterations) goes in sub-bullets nested two spaces under its gate: commentary\n                          the engine never prices, which the Cap must hold. A non-empty declaration pauses the\n                          task for human sign-off —\n                          ",
    "   ### Gated inputs      (REQUIRED — one markdown bullet (\"- \") per human authorisation the task needs:\n                          \"- spend: <what> — cap <amount>\" (a hard cap is mandatory), \"- credential: <what>\",\n                          \"- irreversible: <what>\"; or exactly \"None\". BULLETS ONLY — no prose, commentary,\n                          or footnotes in this section: the engine reads only list lines, and anything else\n                          is rejected. A non-empty declaration pauses the task for human sign-off —\n                          "], // planner
  ["- Does the plan carry the required \"### Gated inputs\" section — either exactly \"None\" or concrete gate\n  BULLETS at column 0 (\"- spend: <what> — cap N USD\", one line WITH a hard cap / \"- credential: …\" /\n  \"- irreversible: …\")? A missing section, a spend gate without a cap, or non-bullet prose in the section\n  (the engine reads only list lines — a gate written as prose is rejected) is an automatic \"changes\"\n  (ADR 0008). Nested sub-bullets under a gate are commentary (how a spend splits) and are allowed; an\n  indented bullet is never a gate. Also flag a gate the brief implies but the plan omits.",
    "- Does the plan carry the required \"### Gated inputs\" section — either exactly \"None\" or concrete gate\n  BULLETS (\"- spend: … — cap …\" WITH a hard cap / \"- credential: …\" / \"- irreversible: …\")? A missing\n  section, a spend gate without a cap, or non-bullet prose in the section (the engine reads only list\n  lines — a gate written as prose is rejected, and commentary does not belong there) is an\n  automatic \"changes\" (ADR 0008). Also flag a gate the brief implies but the plan omits."], // judge
  ["Gated inputs — bullets only: declare spend as one line `- spend: <what> — cap N USD` whose Cap holds\nthe whole spend (its split in nested sub-bullets), credentials, irreversible actions, or exactly \"None\").",
    "Gated inputs — bullets only: declare spend with a hard cap, credentials, irreversible actions, or\nexactly \"None\")."], // plan reviser
  ["missing gate in gatedInputs (\"spend: <what> — cap N USD\", one line whose Cap holds the whole spend, with\nhow it splits in blockerDiagnosis / \"credential: <what>\" / \"irreversible: <what>\") and name them in\nblockerDiagnosis — a human signs off on the note and you'll be re-dispatched.",
    "missing gate in gatedInputs (\"spend: <what> — cap <amount>\" / \"credential: <what>\" / \"irreversible:\n<what>\") and name them in blockerDiagnosis — a human signs off on the note and you'll be re-dispatched."], // GATED_INPUTS_CHECK
]
// A prompt with every p23-1 fragment swapped back for its old text.
const preP23 = (p) => P23_1.reduce((x, [nw, od]) => x.split(nw).join(od), p)
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
  const KILL = '\n\n' + loadEngine(['KILL_RULE']).KILL_RULE
  const r2now = T.reviserPrompt(tR, iR, h2.slice(0, 1), 2, aR, '')
  const r3now = T.reviserPrompt(tR, iR, h2, 3, aR, 'PLAN')
  ok(sha(r2now) === P29_PINS.r2, 'byte pin: unseeded reviserPrompt, round 2 (re-pinned by p29-9: the p29-9 base below plus the Flake check block)')
  ok(sha(r3now) === P29_PINS.r3, 'byte pin: unseeded reviserPrompt, round 3 with the plan (step-back; re-pinned by p29-9)')
  ok(preP29(r2now) !== r2now && preP29(r3now) !== r3now, 'p29-9: both revisers render the Flake check block, so the swap is no no-op')
  // The p29-9 base: the revisers with the block swapped out are their pre-p29-9 bytes (the p31-1 pins).
  const r2new = preP29(r2now)
  const r3new = preP29(r3now)
  ok(sha(r2new) === '7b6822e41c7a117c865fc0522693bbffa61312e50a2e48456ea0599da54a5910',
    'byte pin (p29-9 base): the round-2 reviser with the Flake check block swapped out is its pre-p29-9 bytes (the p31-1 pin)')
  ok(sha(r3new) === '4ff225d5259b81bfbe93f7fa61c59a5d67b2091bc34920697dc955fe6d7996d7',
    'byte pin (p29-9 base): the round-3 reviser with the Flake check block swapped out is its pre-p29-9 bytes (the p31-1 pin)')
  ok(preP31(r2new) !== r2new && preP31(r3new) !== r3new, 'p31-1: both revisers render a p31-1 fragment (the loop), so the swap is no no-op')
  // The p31-1 base: the revisers with p31-1's fragments swapped back are their pre-p31-1 bytes (the p23-1 pins), and
  // every older base below chains on top of it.
  const r2 = preP31(r2new)
  const r3 = preP31(r3new)
  ok(sha(r2) === 'c3efcd934c7a8cb35159177c8786d920092e9ed721e1ae21c609a7413111a703',
    'byte pin (p31-1 base): the round-2 reviser with the p31-1 fragments swapped back is its pre-p31-1 bytes (p23-1 pin)')
  ok(sha(r3) === '97ff33a14d2b551893ee237975369c7e5947db49345828a7f09a6978123c413c',
    'byte pin (p31-1 base): the round-3 reviser with the p31-1 fragments swapped back is its pre-p31-1 bytes (p23-1 pin)')
  ok(preP23(r2) !== r2 && preP23(r3) !== r3, 'p23-1: both revisers render a p23-1 fragment (GATED_INPUTS_CHECK), so the swap is no no-op')
  ok(sha(preP23(r2)) === '7c82d98ade2ee614902acc1de14809c93e8a1c029fe1d2ac4a3e370e5b307f33',
    'byte pin (p23-1 base): the round-2 reviser with the ADR 0038 fragments swapped back is its pre-p23-1 bytes (p18-1 pin)')
  ok(sha(preP23(r3)) === '7cf123a54536b064d21ec820b854216ab61a1c5c19ccb7d3050bffefb5370f07',
    'byte pin (p23-1 base): the round-3 reviser with the ADR 0038 fragments swapped back is its pre-p23-1 bytes (p18-1 pin)')
  ok(sha(preP23(r2).replace(KILL, '')) === '0f7eca821281f140a718ea5bf84cec5c0a134a7924e8b2ff9d3abfe5ea9db585',
    'byte pin (p18-1 base): the round-2 reviser with KILL_RULE removed is its pre-p18-1 bytes')
  ok(sha(preP23(r3).replace(KILL, '')) === '00eb424a53642e113f76ea70fc78644762f75c0a40d2edcee36429f760fed660',
    'byte pin (p18-1 base): the round-3 reviser with KILL_RULE removed is its pre-p18-1 bytes')
  ok(T.reviserPrompt(tR, iR, h2, 3, aR, 'PLAN', null) === T.reviserPrompt(tR, iR, h2, 3, aR, 'PLAN'),
    'byte pin: a null seeded argument renders the unseeded reviser')
  // Every label, prompt and row of three whole task-mode calls (a plan-gated bottom-rung task with a plan
  // revise and two review rounds; a top-rung task on master with env bootstrap and a baseline; a plan-gated
  // read-only task on the top rung). Each task keeps the legacy `model:` that gave the p13-1 engine the same
  // call shape; `rung:` wins over it here.
  // Slotted since estate ADR 0009 d4 made args.verifySlot required: the calls with the slot pieces taken back out
  // (slotRule, slotNote, the wrapped line back to the scrubbed one) are what every pin below hashes, and they hash to
  // the pre-0009 pins, so each slotted prompt is its unslotted bytes plus exactly the slot pieces. The slotted calls
  // themselves have their own pin (the last one).
  const PLAN_TEXT = 'Planned on: abc\n### Files to modify\n- x\n### Gated inputs\nNone'
  const LADDER = { source: 'built-in', rungs: [
    { name: 'opus-high', model: 'opus', effort: 'high', judge: 'high', review: 'xhigh' },
    { name: 'opus-xhigh', model: 'opus', effort: 'xhigh', judge: 'high', review: 'xhigh' },
  ] }
  const mkT = (slug, over = {}) => ({ slug, taskPath: `/vault/Tasks/${slug}.md`, scope: 'cross-cutting', planGate: false, maxIterations: 3, maxReviewRounds: 3, maxPlanRounds: 3, model: 'fable', rung: 'opus-xhigh', ...over })
  const PIN_SLOT = { script: '/plugins/thread/x/skills/execute/scripts/verify-slot.py', slots: 2 }
  const mkA = (task, over = {}) => ({ rolloutSlug: 'proj-rollout-2026-10-01', repoPath: '/repo', verifier: 'make test', date: '2026-10-01', ladder: LADDER, verifySlot: PIN_SLOT, task, ...over })
  const SL = loadEngine(['slotted', 'slotRule', 'slotNote', 'scrubbed'])
  const unslot = (p) => p.split(SL.slotRule('make test', PIN_SLOT)).join('').split(SL.slotNote(PIN_SLOT)).join('')
    .split(SL.slotted('make test', PIN_SLOT)).join(SL.scrubbed('make test'))
  const slottedCalls = []
  const scripted = async (prompt, opts) => {
    const label = opts.label
    const kind = label.split(':')[0]
    const s = label.split(':')[1].split(/[ @]/)[0]
    if (kind === 'plan' || kind === 'plan-revise') return { ready: true, blocked: false, blockerCause: '', plan: PLAN_TEXT }
    if (kind === 'plan-judge') return { verdict: label.endsWith(' r1') ? 'changes' : 'approve', feedback: label.endsWith(' r1') ? ['fix ' + label] : [] }
    if (kind === 'review') return { verdict: /r[12]$/.test(label) ? 'changes' : 'approve', feedback: /r[12]$/.test(label) ? ['fix ' + label] : [] }
    return { verified: true, blocked: false, escalate: false, prUrl: kind === 'investigate' ? '' : `https://github.com/o/r/pull/${s}`, branch: kind === 'investigate' ? '' : `audit-fix/${s}`, worktreePath: `/repo/.claude/worktrees/${s}`, blockerDiagnosis: '', summary: `${label} done` }
  }
  const RULE = loadEngine(['NEEDS_HUMAN_RULE']).NEEDS_HUMAN_RULE
  const calls = []
  const rows = []
  const p23Calls = []
  const p31Calls = []
  const slottedP31Calls = []
  const p29Calls = []
  const slottedP29Calls = []
  const p29Rows = []
  const logs = []
  const baseCalls = []
  const oldCalls = []
  const oldRows = []
  const baseRows = []
  for (const args of [
    mkA(mkT('proj-fix-p', { model: 'opus', rung: 'opus-high', planGate: true })),
    mkA(mkT('proj-fix-a'), { defaultBranch: 'master', envBootstrap: 'poetry install', knownBaselineFailures: ['t — env'] }),
    mkA(mkT('proj-audit-x', { scope: 'read-only', planGate: true })),
  ]) {
    const r = await runTask(args, scripted)
    slottedCalls.push(JSON.stringify(r.calls))
    slottedP29Calls.push(JSON.stringify(r.calls.map((c) => ({ ...c, prompt: preP29(c.prompt) }))))
    slottedP31Calls.push(JSON.stringify(r.calls.map((c) => ({ ...c, prompt: preP31(preP29(c.prompt), PIN_SLOT) }))))
    ok(r.calls.length > 0 && r.calls.every((c) => !c.prompt.includes(SL.scrubbed('make test'))), `ADR 0009 d4: ${args.task.slug}: no prompt renders the bare verifier`)
    r.calls = r.calls.map((c) => ({ ...c, prompt: unslot(c.prompt) }))
    calls.push(JSON.stringify(r.calls))
    p29Calls.push(JSON.stringify(r.calls.map((c) => ({ ...c, prompt: preP29(c.prompt) }))))
    rows.push(JSON.stringify({ result: r.result, err: r.error && String(r.error) }))
    logs.push(...r.logs)
    // Every older base chains on top of the p29-9 one, then the p31-1 one: the calls with the Flake check block
    // swapped out, then p31-1's fragments swapped back.
    const pre = r.calls.map((c) => ({ ...c, prompt: preP31(preP29(c.prompt)) }))
    p31Calls.push(JSON.stringify(pre))
    p23Calls.push(JSON.stringify(pre.map((c) => ({ ...c, prompt: preP23(c.prompt) }))))
    baseCalls.push(JSON.stringify(pre.map((c) => ({ ...c, prompt: preP23(c.prompt).replace(KILL, '') }))))
    oldCalls.push(JSON.stringify(pre.map((c) => ({ ...c, prompt: preP23(c.prompt).replace(KILL, '').replace(RULE, '') }))))
    const p29 = JSON.parse(JSON.stringify(r.result))
    for (const row of p29.tasks) delete row.flakes
    p29Rows.push(JSON.stringify({ result: p29, err: r.error && String(r.error) }))
    const base = JSON.parse(JSON.stringify(r.result))
    for (const row of base.tasks) { delete row.reviewVerdicts; delete row.flakes }
    baseRows.push(JSON.stringify({ result: base, err: r.error && String(r.error) }))
    const old = JSON.parse(JSON.stringify(r.result))
    for (const row of old.tasks) { delete row.needsHuman; delete row.reviewVerdicts; delete row.flakes }
    oldRows.push(JSON.stringify({ result: old, err: r.error && String(r.error) }))
    const [row] = r.result.tasks
    const want = row.scope === 'read-only' ? [] : [1, 2, 3].map((n) => ({
      round: n, verdict: n < 3 ? 'changes' : 'approve', head: '', feedback: n < 3 ? [`fix review:${row.slug} r${n}`] : [],
    }))
    ok(JSON.stringify(row.reviewVerdicts) === JSON.stringify(want), `p21-3: ${row.slug}'s reviewVerdicts are its judged rounds`)
  }
  ok(sha(oldCalls.join('\n')) === 'ee821ac64ee16a13cf95c536bcbbf4ef7106c45c0d28c002f11b61196b1ee54b',
    'byte pin (p16-3 base): the same calls with KILL_RULE and NEEDS_HUMAN_RULE removed are the pre-p16-3 bytes')
  ok(sha(baseCalls.join('\n')) === '8236605ff29f46cc2c59346eb3bd42916deb8c9fda1859cb9eaaadec9fa607c4',
    'byte pin (p18-1 base): the same calls with KILL_RULE removed are the pre-p18-1 bytes')
  ok(sha(oldRows.join('\n')) === '0b7fa8531f41dad8da30902e500d4cc7746f1540424af004039ab890433972aa',
    'byte pin (p16-3 base): the same rows with needsHuman and reviewVerdicts deleted are the pre-p16-3 rows')
  ok(sha(baseRows.join('\n')) === '7a9ecf48734cee23672a77dbbde09a3fcee91a110746b46665bc3aaecd0984da',
    'byte pin (p21-3 base): the same rows with reviewVerdicts deleted are the pre-p21-3 rows')
  for (const [i, [nw]] of P23_1.entries()) ok(calls.some((c) => c.includes(JSON.stringify(nw).slice(1, -1))), `p23-1: fragment ${i + 1} renders in these calls, so its swap is no no-op`)
  ok(logs.every((l) => !l.includes('ADR 0038')), 'p23-1: no log line of these calls names ADR 0038 (no gatePricer, no bounce)')
  ok(sha(p23Calls.join('\n')) === '1e51b62c997f39814ea75373fe38d97955c596ce77c7aa63762a4ab5c230cacc',
    'byte pin (p23-1 base): the same calls with the ADR 0038 fragments swapped back are the pre-p23-1 bytes (the p18-1 calls pin)')
  ok(sha(p31Calls.join('\n')) === '4f524ab665ea21cfbacd5db589bcb09d63bb45d1f4420fbe82053dde19e680f0',
    'byte pin (p31-1 base): the same calls with the p31-1 fragments swapped back are the pre-p31-1 bytes (the p23-1 calls pin)')
  ok(sha(p29Calls.join('\n')) === 'b82f1748cd48dcbfbc737383ffd95e2b08f0aec066e36e3b7afe7ff1fd3adcaf',
    'byte pin (p29-9 base): the same calls with the Flake check block swapped out are the pre-p29-9 bytes (the p31-1 calls pin)')
  ok(calls.some((c) => c.includes(JSON.stringify(P29_9[0][0]).slice(1, -1))), 'p29-9: the task block renders in these calls, so its swap is no no-op')
  ok(sha(calls.join('\n')) === P29_PINS.calls,
    'byte pin: three whole task-mode calls — every label and prompt (re-pinned by p29-9: the p29-9 base above plus the Flake check block)')
  // Each p31-1 pair these calls can render renders here, so its swap is no no-op; the matrix-only pairs render nowhere.
  for (const [slot, hay, which] of [[undefined, calls, 'unslotted'], [PIN_SLOT, slottedCalls, 'slotted']]) {
    for (const [nw, od, label] of p31Pairs(slot)) {
      if (nw === od) continue
      const seen = hay.some((c) => c.includes(JSON.stringify(nw).slice(1, -1)))
      ok(P31_MATRIX_ONLY.includes(label) ? !seen : seen, `p31-1: the ${label} pair ${P31_MATRIX_ONLY.includes(label) ? 'is in no pinned call' : 'renders in these calls'} (${which}), so its swap is no no-op`)
    }
  }
  ok(sha(p29Rows.join('\n')) === '0137cf70ddf1d5131b4511462f43f1d639311e6b4ada4016af30a2269bd563d4',
    'byte pin (p29-9 base): the same rows with flakes deleted are the pre-p29-9 rows (the p21-3 rows pin)')
  ok(sha(rows.join('\n')) === P29_PINS.rows,
    'byte pin: three whole task-mode calls — every row, rung record, reviewVerdicts and flakes included (re-pinned by p29-9: the p29-9 base above plus flakes)')
  ok(slottedCalls.join('\n') !== calls.join('\n'), 'ADR 0009 d4: the slot is in these calls, so taking it out is no no-op')
  ok(sha(slottedP31Calls.join('\n')) === '986d4024967d3b0c2cd38db5372fcf6637fb5102e2319c75d28444cba44a1f3c',
    'byte pin (p31-1 base, slotted): the slotted calls with the p31-1 fragments swapped back are the pre-p31-1 bytes (the estate ADR 0009 d4 pin)')
  ok(sha(slottedP29Calls.join('\n')) === 'deac8755b9c27275aee06d51a3b45556d7e34b3b252047ec126e15ec3899f89d',
    'byte pin (p29-9 base, slotted): the slotted calls with the Flake check block swapped out are the pre-p29-9 bytes (the p31-1 slotted pin)')
  ok(sha(slottedCalls.join('\n')) === P29_PINS.slotted,
    'byte pin (estate ADR 0009 d4; re-pinned by p29-9): the same three calls as run, slotted — the unslotted calls pin above plus exactly the slot pieces')
}

console.log()
console.log(fail === 0 ? 'ALL PASS' : 'SOME FAILED')
process.exit(fail)
