// Verifies the resume-cache invariant for the optional features in wave-execute.workflow.js:
//   - gateOverride(task)      → '' when ignoreGate is unset (byte-identical prompts), text when set
//   - envBootstrapStep(a)     → '' when envBootstrap is unset, a command line when set
//   - worktreeSetup(a, task)  → identical to its pre-feature output when envBootstrap is unset; when set,
//                               it equals the unset output PLUS exactly the injected bootstrap line.
//   - escalationContext(prior)→ '' when prior is empty, hand-over block when set; a prompt with prior
//                               equals the prior-less prompt PLUS exactly the injected block.
//   - verifyBlock(tier, …)    → opus renders the ONE-SHOT block (no iteration), fable the full Ralph loop.
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
head += '\nvar __t = { gateOverride, envBootstrapStep, worktreeSetup, escalationContext, verifyBlock, oneShotVerify, ralphLoop, implementerPrompt, runAgent, planLoop, implement, reviewLoop, converge };\n'

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

console.log()
console.log(fail === 0 ? 'ALL PASS' : 'SOME FAILED')
process.exit(fail)
