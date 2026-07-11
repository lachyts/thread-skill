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
head += '\nvar __t = { gateOverride, envBootstrapStep, worktreeSetup, escalationContext, verifyBlock, oneShotVerify, ralphLoop, implementerPrompt };\n'

const ctx = { console }
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

console.log()
console.log(fail === 0 ? 'ALL PASS' : 'SOME FAILED')
process.exit(fail)
