// p12-14 (ADR 0008, ADR 0030 decision 4): a gate-pending task, once its gates are signed, resumes its OWN
// Workflow call with `resumeFromRunId` and `task.approvedGates` added while the lead holds its handle, so the
// plan the human signed replays from cache and that resume makes no plan call (execute § 3.7). Two halves are
// pinned here:
//
// 1. The Verify test: every prompt the engine renders is byte-identical with and without
//    task.approvedGates, so adding it to a resumed call's args changes no agent()'s prompt and the replay
//    cache stays valid. That is the invariant SKILL.md's "one sanctioned exception" rests on.
// 2. The whole-run replay prefix: run A (no approvedGates) stops gate-pending; run B (A's args plus
//    task.approvedGates = A's gatedInputs, nothing else) must replay A's calls as a byte-identical prefix
//    (label, prompt, model, effort, schema, phase), make no second plan call, and go on past the sign-off.
//    A replayed implementer or reviser stop is answered by a same-rung continuation (`<label> signed`,
//    the stopped prompt plus SIGNED_GATES_RESUME), never read as hardness or a block. An agent that finds
//    gates one after another (A stops for G; B's continuation stops for G2; C) is answered at each sign-off:
//    C replays B as a byte-identical prefix and goes on with `<label> signed 2`. Then the E1/E2 bounds: a
//    site continues past each approved gate once, and a stop that repeats only passed gates takes the old path.
//
// Runs the WHOLE script through tests/lib/engine.mjs runTask() with a label-keyed agent stub that throws on
// any label it was not given (so a stray dispatch fails loudly).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { runTask, loadEngine, enginePath } from '../../../tests/lib/engine.mjs'

const SLUG = 'proj-gate-x'
const PR = 'https://github.com/o/r/pull/9'
const BR = 'audit-fix/gate-x'
const WT = '/repo/.claude/worktrees/proj-gate-x'
const G = 'spend: Replicate API — cap USD 30'
const G2 = 'credential: PROD_API_KEY'
const PLAN_G = `Planned on: abc\n### Files to modify\n- x.js: the change\n### Gated inputs\n- ${G}\n### Risks / unknowns\n- none`
const PLAN_NONE = 'Planned on: abc\n### Files to modify\n- x.js: the change\n### Gated inputs\nNone\n### Risks / unknowns\n- none'
// The built-in ladder's two rungs: a task starts on BOTTOM by default; TOP is the ceiling.
const BOTTOM = 'opus-high'
const TOP = 'opus-xhigh'

// SIGNED_GATES_RESUME is p12-14's: absent from an engine without the continuation, so it loads lazily and
// the tests that need it fail with a named assertion instead of crashing the file.
const SG = (() => { try { return loadEngine(['SIGNED_GATES_RESUME']).SIGNED_GATES_RESUME } catch { return null } })()

const mkTask = (over = {}) => ({
  slug: SLUG, taskPath: `/vault/Tasks/${SLUG}.md`, scope: 'cross-cutting', planGate: false,
  maxIterations: 3, maxReviewRounds: 3, maxPlanRounds: 3, rung: BOTTOM, ...over,
})
const mkArgs = (taskOver = {}, over = {}) => ({
  rolloutSlug: 'proj-rollout-2026-10-02', repoPath: '/repo', verifier: 'make test', date: '2026-10-02',
  task: mkTask(taskOver), ...over,
})

const green = (label) => ({ verified: true, blocked: false, escalate: false, prUrl: PR, branch: BR, worktreePath: WT, blockerDiagnosis: '', summary: `${label} done` })
const red = { verified: false, blocked: false, escalate: true, prUrl: '', branch: BR, worktreePath: WT, blockerDiagnosis: 'one-shot red', summary: 'tried' }
const gated = (gates) => ({ verified: false, blocked: true, escalate: false, prUrl: '', branch: BR, worktreePath: WT, blockerDiagnosis: 'stopped before a gated action', summary: '', gatedInputs: gates })
const plainBlock = { verified: false, blocked: true, escalate: false, prUrl: '', branch: BR, worktreePath: WT, blockerDiagnosis: 'red after the loop', summary: '' }
const approve = { verdict: 'approve', feedback: [] }
const changes = (f) => ({ verdict: 'changes', feedback: [f] })
const plan = (text) => ({ ready: true, blocked: false, blockerCause: '', plan: text })

// script[label] is a result, a function (prompt, opts) → result, or a list consumed one per dispatch.
// Every dispatch is recorded with its prompt and every opt the cache key can see.
async function run(args, script) {
  const unknown = []
  const calls = []
  const left = Object.fromEntries(Object.entries(script).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]))
  const out = await runTask(args, async (prompt, o) => {
    calls.push({ label: o.label, prompt, model: o.model, effort: o.effort, phase: o.phase, schema: JSON.stringify(o.schema) })
    if (!(o.label in left)) { unknown.push(o.label); throw new Error('stub: unknown agent label ' + o.label) }
    let v = left[o.label]
    if (Array.isArray(v)) v = v.length > 1 ? v.shift() : v[0]
    return typeof v === 'function' ? v(prompt, o) : v
  })
  return { ...out, unknown, calls, labels: calls.map((c) => c.label), row: out.result && out.result.tasks[0] }
}
const clean = (r) => {
  assert.equal(r.error, undefined, String(r.error && r.error.stack))
  assert.deepEqual(r.unknown, [])
}
const omit = (o, k) => Object.fromEntries(Object.entries(o).filter(([key]) => key !== k))

// Run A, then B = A's args plus task.approvedGates = A's gatedInputs. Asserts the shared contract and
// returns both runs plus B's calls after the prefix.
async function resumeAfterSignOff(argsA, script, next) {
  const A = await run(argsA, script)
  clean(A)
  assert.equal(A.row.status, 'gate-pending', 'run A stops gate-pending')
  assert.ok(A.row.gatedInputs.length > 0, 'run A surfaces its gates')
  const argsB = structuredClone(argsA)
  argsB.task.approvedGates = [...A.row.gatedInputs]
  assert.deepEqual({ ...argsB, task: omit(argsB.task, 'approvedGates') }, argsA, 'B differs from A only in task.approvedGates')
  assert.notDeepEqual(argsB, argsA)
  const B = await run(argsB, script)
  clean(B)
  assert.ok(B.calls.length > A.calls.length, 'B goes past the stop')
  assert.deepEqual(B.calls.slice(0, A.calls.length), A.calls, "A's calls are a byte-identical prefix of B's (label, prompt, every opt)")
  const tail = B.calls.slice(A.calls.length)
  assert.equal(B.row.status, 'review', 'B lands at review')
  assert.ok(tail.every((c) => !/^plan(-judge|-revise)?:/.test(c.label)), `B makes no second plan call: ${B.labels}`)
  assert.equal(tail[0].label, next, "B's first call past the prefix")
  return { A, B, tail }
}
// A→B→C: an agent that finds gates one after another. A stops for G; B (G signed) replays A and its
// continuation stops for G2; C (G and G2 signed, B's args otherwise) must replay B's calls as a byte-identical
// prefix and go on past the second sign-off — never climbed, never blocked. Returns the three runs and C's
// calls after B's prefix.
async function resumeTwiceAfterSignOff(argsA, script, next) {
  const A = await run(argsA, script)
  clean(A)
  assert.equal(A.row.status, 'gate-pending', 'run A stops gate-pending')
  const argsB = structuredClone(argsA)
  argsB.task.approvedGates = [...A.row.gatedInputs]
  const B = await run(argsB, script)
  clean(B)
  assert.equal(B.row.status, 'gate-pending', "run B's continuation stops for a new gate")
  assert.deepEqual(B.calls.slice(0, A.calls.length), A.calls, "A's calls are a byte-identical prefix of B's")
  assert.ok(B.row.gatedInputs.every((g) => !argsB.task.approvedGates.includes(g)), 'B surfaces only the new gate')
  const argsC = structuredClone(argsB)
  argsC.task.approvedGates = [...argsB.task.approvedGates, ...B.row.gatedInputs]
  assert.deepEqual({ ...argsC, task: omit(argsC.task, 'approvedGates') }, argsA, 'C differs from A only in task.approvedGates')
  const C = await run(argsC, script)
  clean(C)
  assert.ok(C.calls.length > B.calls.length, 'C goes past the second stop')
  assert.deepEqual(C.calls.slice(0, B.calls.length), B.calls, "B's calls are a byte-identical prefix of C's (label, prompt, every opt)")
  const tail = C.calls.slice(B.calls.length)
  assert.equal(C.row.status, 'review', 'C lands at review, every gate signed')
  assert.ok(tail.every((c) => !/^plan(-judge|-revise)?:/.test(c.label)), `C makes no second plan call: ${C.labels}`)
  assert.equal(tail[0].label, next, "C's first call past the prefix")
  return { A, B, C, tail }
}
// The n-th continuation is the stopped prompt plus exactly SIGNED_GATES_RESUME, at the stopped call's opts.
function assertContinuation(r, stopped, n = 1) {
  assert.equal(typeof SG, 'string', 'the engine defines SIGNED_GATES_RESUME')
  const s = r.calls.find((c) => c.label === stopped)
  const c = r.calls.find((x) => x.label === `${stopped} signed${n === 1 ? '' : ' ' + n}`)
  assert.ok(s && c, `${stopped} and its continuation ${n} both dispatched`)
  assert.equal(c.prompt, s.prompt + '\n\n' + SG, 'continuation == stopped prompt + exactly the injected block')
  for (const k of ['model', 'effort', 'phase', 'schema']) assert.equal(c[k], s[k], `continuation keeps ${k}`)
}
const noGateTextInPrompts = (r, gates) => {
  for (const c of r.calls) for (const g of gates) assert.ok(!c.prompt.includes(g), `${c.label}: approvedGates never reach a prompt`)
}

// ---- 1. the Verify test: every prompt renders the same with and without approvedGates -------------------

const BUILDERS = [
  'implementerPrompt', 'readOnlyPrompt', 'plannerPrompt', 'planJudgePrompt', 'planReviserPrompt',
  'approvedPlanImplementerPrompt', 'reviewJudgePrompt', 'reviserPrompt', 'integratorPrompt', 'integrationReviewPrompt',
]
const FRAGMENTS = [
  'worktreeSetup', 'taskTreeSetup', 'branchTreeSetup', 'coldEntryBlock', 'gateOverride',
  'integrationMergeStep', 'integrationMergeReads', 'integrationJudgeCheck', 'landedBlock',
]
const E = loadEngine([...BUILDERS, ...FRAGMENTS, 'rungState', 'escalate', 'rungRecord'])

const sha = (c) => c.repeat(40)
const HIST = [{ round: 1, feedback: ['own-run fix'] }, { round: 2, feedback: ['keep their rename'], stage: 'integration' }]
const LANDED = [{ prUrl: 'https://github.com/o/r/pull/5', title: 'theirs', files: ['a.js'], taskPath: '/vault/Tasks/theirs.md' }]
const SENTINEL_GATES = ['spend: SENTINEL-p12-14 — cap USD 7', 'credential: SENTINEL-KEY']
// st as converge() builds it (rungState, then escalate), for the three shapes a prompt can see: a first pass
// on the bottom rung, after a real climb, and on the top rung after a climb recorded as a no-op.
const stateOf = (rung, stages) => {
  const st = E.rungState({ slug: SLUG, rung }, {})
  for (const stage of stages) E.escalate(st, SLUG, stage)
  return st
}
const STATES = {
  bottom: stateOf(BOTTOM, []),
  climbed: stateOf(BOTTOM, ['plan', 'implement']),
  top: stateOf(TOP, ['plan', 'implement', 'review']),
}
const ARG_VARIANTS = [
  { name: 'base', args: {}, task: {} },
  { name: 'ladder', args: { ladder: { source: '/home/x/.config/thread/ladder.toml', rungs: [{ name: 'solo', model: 'fable', effort: 'high', judge: 'high', review: 'max' }] } }, task: {} },
  { name: 'envBootstrap', args: { envBootstrap: 'poetry env use 3.11 && poetry install' }, task: {} },
  { name: 'defaultBranch', args: { defaultBranch: 'master' }, task: {} },
  { name: 'knownBaselineFailures', args: { knownBaselineFailures: ['test_x — env (pre-existing)'] }, task: {} },
  { name: 'ignoreGate', args: {}, task: { ignoreGate: true } },
  { name: 'legacy model and effort', args: {}, task: { model: 'fable', effort: 'max' } },
]

// Every render the engine can produce from a task object, as (E, task, a, st, c) → string. `c` carries the
// matrix's prior / plan / history / Integration inputs.
const RENDERS = {
  implementerPrompt: (E, t, a, st, c) => E.implementerPrompt(t, a, st, c.prior),
  readOnlyPrompt: (E, t, a, st, c) => E.readOnlyPrompt(t, a, st, c.prior),
  plannerPrompt: (E, t, a, st, c) => E.plannerPrompt(t, a, st, c.prior),
  planJudgePrompt: (E, t, a, st, c) => E.planJudgePrompt(t, c.plan || PLAN_NONE, a),
  planReviserPrompt: (E, t, a, st, c) => E.planReviserPrompt(t, c.plan || PLAN_NONE, HIST, 2, a),
  approvedPlanImplementerPrompt: (E, t, a, st, c) => E.approvedPlanImplementerPrompt(t, c.plan || PLAN_NONE, a, st, c.prior),
  reviewJudgePrompt: (E, t, a, st, c) => E.reviewJudgePrompt(t, c.prev, a, c.history),
  reviserPrompt: (E, t, a, st, c) => E.reviserPrompt(t, c.prev, HIST, 3, a, c.plan),
  'reviserPrompt (seeded)': (E, t, a, st, c) => E.reviserPrompt(t, c.prev, HIST, 3, a, c.plan, { history: HIST, roundsUsed: 2 }),
  integratorPrompt: (E, t, a, st, c) => E.integratorPrompt(t, a, c.I),
  integrationReviewPrompt: (E, t, a, st, c) => E.integrationReviewPrompt(t, a, c.I, c.j),
  worktreeSetup: (E, t, a) => E.worktreeSetup(a, t),
  'taskTreeSetup (refresh)': (E, t, a) => E.taskTreeSetup(a, t, true),
  taskTreeSetup: (E, t, a) => E.taskTreeSetup(a, t, false),
  branchTreeSetup: (E, t, a) => E.branchTreeSetup(a, t, true, true),
  'branchTreeSetup (judge)': (E, t, a) => E.branchTreeSetup(a, t, false),
  coldEntryBlock: (E, t, a) => E.coldEntryBlock(a, t, HIST),
  gateOverride: (E, t) => E.gateOverride(t),
  integrationMergeStep: (E, t, a, st, c) => E.integrationMergeStep(a, t, c.I),
  integrationMergeReads: (E, t, a, st, c) => E.integrationMergeReads(a, t, c.I, c.j),
  integrationJudgeCheck: (E, t, a, st, c) => E.integrationJudgeCheck(a, t, c.I, c.j),
  landedBlock: (E, t, a, st, c) => E.landedBlock(a, t, c.I),
}

// Named failures: `<render> [<matrix point>]` for every render that differs with approvedGates or carries
// the sentinel. [] means the invariant holds. `E` is the engine's function bag (the control swaps one).
function approvedGatesLeaks(E) {
  const fails = []
  let renders = 0
  for (const [stName, st] of Object.entries(STATES)) {
    for (const prior of ['', 'first pass went red: the verifier failed on test_y']) {
      for (const planText of ['', PLAN_G]) {
        for (const scope of ['cross-cutting', 'single-file', 'read-only']) {
          for (const v of ARG_VARIANTS) {
            for (const landed of [[], LANDED]) {
              const a = { ...mkArgs({ scope, planGate: !!planText, ...v.task }), ...v.args }
              const task = a.task
              const withGates = { ...task, approvedGates: SENTINEL_GATES }
              const I = {
                prUrl: PR, branch: BR, worktreePath: WT, headSha: sha('a'), taskBase: sha('b'), mainSha: sha('c'),
                trouble: ['conflict'], landed, plan: planText, reviewHistory: HIST, reviewRoundsUsed: 2,
                rung: E.rungRecord(st),
              }
              const c = {
                prior, plan: planText, I, history: prior ? HIST : [],
                prev: { prUrl: PR, branch: BR, worktreePath: WT },
                j: { mergeCommit: sha('d'), headSha: sha('e'), baseSha: sha('f'), triggers: ['conflict'], path: 'integrator' },
              }
              for (const [name, render] of Object.entries(RENDERS)) {
                const at = `${name} [${stName} prior=${!!prior} plan=${!!planText} ${scope} ${v.name} landed=${landed.length}]`
                const without = render(E, task, a, st, c)
                const withA = render(E, withGates, { ...a, task: withGates }, st, c)
                renders += 2
                if (typeof without !== 'string' || without !== withA) fails.push(`${at}: differs with approvedGates`)
                else if (withA.includes('SENTINEL')) fails.push(`${at}: carries an approved gate`)
              }
            }
          }
        }
      }
    }
  }
  return { fails, renders }
}

test('Verify: every prompt and task-taking fragment renders byte-identical with and without approvedGates', () => {
  const { fails, renders } = approvedGatesLeaks(E)
  assert.deepEqual(fails, [])
  assert.ok(renders > 10000, `${renders} renders`)
})

test('Verify: every prompt builder in the engine is in the render table', () => {
  const src = fs.readFileSync(enginePath, 'utf8')
  const builders = [...src.matchAll(/^function (\w+Prompt)\(/gm)].map((m) => m[1])
  assert.ok(builders.length >= 10, `${builders.length} builders found`)
  assert.deepEqual(builders.filter((b) => !(b in RENDERS)), [], 'a new builder must join RENDERS')
  assert.deepEqual([...BUILDERS].sort(), [...builders].sort())
})

test('control: a builder that renders task.approvedGates makes the check fail', () => {
  const leaky = { ...E, implementerPrompt: (t, a, st, prior) => E.implementerPrompt(t, a, st, prior) + (t.approvedGates ? '\n' + t.approvedGates.join('\n') : '') }
  const { fails } = approvedGatesLeaks(leaky)
  assert.ok(fails.length > 0, 'the leak is caught')
  assert.ok(fails.every((f) => f.startsWith('implementerPrompt [')), fails.slice(0, 3).join('\n'))
  const sneaky = { ...E, gateOverride: (t) => (t.approvedGates ? `\n\nApproved: ${t.approvedGates[0]}` : E.gateOverride(t)) }
  assert.ok(approvedGatesLeaks(sneaky).fails.some((f) => f.startsWith('gateOverride [')), 'a fragment leak is caught too')
})

// ---- 2. the whole-run replay prefix ------------------------------------------------------------------

test('S-plan: a plan-gated stop resumes on the signed plan — the implementer runs it, nothing re-planned', async () => {
  const script = {
    [`plan:${SLUG}`]: plan(PLAN_G),
    [`plan-judge:${SLUG} r1`]: approve,
    [`implement:${SLUG}`]: green(`implement:${SLUG}`),
    [`review:${SLUG} r1`]: approve,
  }
  const { A, B, tail } = await resumeAfterSignOff(mkArgs({ planGate: true }), script, `implement:${SLUG}`)
  assert.deepEqual(A.labels, [`plan:${SLUG}`, `plan-judge:${SLUG} r1`])
  assert.deepEqual(A.row.gatedInputs, [G])
  assert.ok(tail[0].prompt.includes(PLAN_G), "the implementer's prompt carries A's signed plan")
  assert.deepEqual(B.labels, [`plan:${SLUG}`, `plan-judge:${SLUG} r1`, `implement:${SLUG}`, `review:${SLUG} r1`])
  assert.equal(B.row.planRoundsUsed, 1)
})

test('S-plan-r2: a gate declared on a revised plan — the revise and the climb sit inside the prefix', async () => {
  const script = {
    [`plan:${SLUG}`]: plan(PLAN_NONE),
    [`plan-judge:${SLUG} r1`]: changes('declare the Replicate spend'),
    [`plan-revise:${SLUG} r2`]: plan(PLAN_G),
    [`plan-judge:${SLUG} r2`]: approve,
    [`implement:${SLUG}`]: green(`implement:${SLUG}`),
    [`review:${SLUG} r1`]: approve,
  }
  const { A, B, tail } = await resumeAfterSignOff(mkArgs({ planGate: true }), script, `implement:${SLUG}`)
  assert.deepEqual(A.labels, [`plan:${SLUG}`, `plan-judge:${SLUG} r1`, `plan-revise:${SLUG} r2`, `plan-judge:${SLUG} r2`])
  assert.equal(A.calls[2].effort, 'xhigh', 'the plan climb happened in A')
  assert.ok(tail[0].prompt.includes(PLAN_G))
  assert.equal(tail[0].effort, 'xhigh', 'the implementer runs on the rung A reached')
  assert.deepEqual([B.row.rung, B.row.climbs, B.row.planRoundsUsed], [TOP, [{ stage: 'plan', from: BOTTOM, to: TOP }], 2])
})

test('S-impl: a bottom-rung implementer stop resumes past the sign-off on its rung — never climbed', async () => {
  const script = {
    [`implement:${SLUG}`]: gated([G]),
    [`implement:${SLUG} signed`]: green(`implement:${SLUG} signed`),
    [`review:${SLUG} r1`]: approve,
  }
  const { A, B } = await resumeAfterSignOff(mkArgs(), script, `implement:${SLUG} signed`)
  assert.deepEqual(A.labels, [`implement:${SLUG}`])
  assert.deepEqual(B.labels, [`implement:${SLUG}`, `implement:${SLUG} signed`, `review:${SLUG} r1`])
  assert.ok(B.labels.every((l) => !l.includes('@')), 'no takeover')
  assert.deepEqual([B.row.rung, B.row.climbs], [BOTTOM, []])
  assertContinuation(B, `implement:${SLUG}`)
  assert.deepEqual([B.calls[1].model, B.calls[1].effort], ['opus', 'high'])
  noGateTextInPrompts(B, [G])
})

test('S-impl-top: a top-rung implementer stop resumes past the sign-off — never set aside blocked', async () => {
  const script = {
    [`implement:${SLUG}`]: gated([G]),
    [`implement:${SLUG} signed`]: green(`implement:${SLUG} signed`),
    [`review:${SLUG} r1`]: approve,
  }
  const { B } = await resumeAfterSignOff(mkArgs({ rung: TOP }), script, `implement:${SLUG} signed`)
  assert.deepEqual(B.labels, [`implement:${SLUG}`, `implement:${SLUG} signed`, `review:${SLUG} r1`])
  assert.deepEqual([B.row.rung, B.row.climbs], [TOP, []])
  assertContinuation(B, `implement:${SLUG}`)
  noGateTextInPrompts(B, [G])
})

test('S-impl-plan: a plan-gated task whose implementer gates resumes on its plan — no re-plan, no climb', async () => {
  const script = {
    [`plan:${SLUG}`]: plan(PLAN_NONE),
    [`plan-judge:${SLUG} r1`]: approve,
    [`implement:${SLUG}`]: gated([G]),
    [`implement:${SLUG} signed`]: green(`implement:${SLUG} signed`),
    [`review:${SLUG} r1`]: approve,
  }
  const { A, B, tail } = await resumeAfterSignOff(mkArgs({ planGate: true }), script, `implement:${SLUG} signed`)
  assert.deepEqual(A.labels, [`plan:${SLUG}`, `plan-judge:${SLUG} r1`, `implement:${SLUG}`])
  assert.equal(A.row.planRoundsUsed, 1)
  assert.ok(tail[0].prompt.includes(PLAN_NONE), 'the continuation implements the approved plan')
  assert.deepEqual(B.labels.filter((l) => l.startsWith('plan:')), [`plan:${SLUG}`])
  assert.deepEqual([B.row.rung, B.row.climbs, B.row.planRoundsUsed], [BOTTOM, [], 1])
  assertContinuation(B, `implement:${SLUG}`)
})

test('S-impl-retry: a stop on the retry after a climb resumes on the reached rung, the climb replayed from cache', async () => {
  const script = {
    [`implement:${SLUG}`]: red,
    [`implement:${SLUG}@${TOP}`]: gated([G]),
    [`implement:${SLUG}@${TOP} signed`]: green(`implement:${SLUG}@${TOP} signed`),
    [`review:${SLUG} r1`]: approve,
  }
  const { A, B } = await resumeAfterSignOff(mkArgs(), script, `implement:${SLUG}@${TOP} signed`)
  const climbs = [{ stage: 'implement', from: BOTTOM, to: TOP }]
  assert.deepEqual(A.labels, [`implement:${SLUG}`, `implement:${SLUG}@${TOP}`])
  assert.deepEqual([A.row.rung, A.row.climbs], [TOP, climbs])
  assert.deepEqual(B.labels, [`implement:${SLUG}`, `implement:${SLUG}@${TOP}`, `implement:${SLUG}@${TOP} signed`, `review:${SLUG} r1`])
  assert.deepEqual([B.row.rung, B.row.climbs], [TOP, climbs])
  assertContinuation(B, `implement:${SLUG}@${TOP}`)
  noGateTextInPrompts(B, [G])
})

test("S-revise: an own run's reviser stop resumes past the sign-off, then the judge", async () => {
  const script = {
    [`implement:${SLUG}`]: green(`implement:${SLUG}`),
    [`review:${SLUG} r1`]: changes('handle the empty corpus'),
    [`revise:${SLUG} r2`]: gated([G]),
    [`revise:${SLUG} r2 signed`]: green(`revise:${SLUG} r2 signed`),
    [`review:${SLUG} r2`]: approve,
  }
  const { A, B } = await resumeAfterSignOff(mkArgs({ rung: TOP }), script, `revise:${SLUG} r2 signed`)
  assert.deepEqual(A.labels, [`implement:${SLUG}`, `review:${SLUG} r1`, `revise:${SLUG} r2`])
  assert.deepEqual(B.labels, [...A.labels, `revise:${SLUG} r2 signed`, `review:${SLUG} r2`])
  assert.equal(B.row.reviewRoundsUsed, 2)
  assertContinuation(B, `revise:${SLUG} r2`)
  noGateTextInPrompts(B, [G])
})

test('S-seeded: a seeded revise stop resumes past the sign-off, then the judge', async () => {
  const resume = { stage: 'revise', prUrl: PR, branch: BR, worktreePath: WT, reviewHistory: [{ round: 1, feedback: ['keep their rename'], stage: 'integration' }], reviewRoundsUsed: 1, plan: '' }
  const script = {
    [`revise:${SLUG} r2`]: gated([G]),
    [`revise:${SLUG} r2 signed`]: green(`revise:${SLUG} r2 signed`),
    [`review:${SLUG} r2`]: approve,
  }
  const { A, B } = await resumeAfterSignOff(mkArgs({ rung: TOP, resume }), script, `revise:${SLUG} r2 signed`)
  assert.deepEqual(A.labels, [`revise:${SLUG} r2`])
  assert.deepEqual(B.labels, [`revise:${SLUG} r2`, `revise:${SLUG} r2 signed`, `review:${SLUG} r2`])
  assert.ok(B.calls[1].prompt.includes('COLD ENTRY'), 'the continuation keeps the cold entry')
  assertContinuation(B, `revise:${SLUG} r2`)
  noGateTextInPrompts(B, [G])
})

// ---- 3. gates found one after another: A → B → C ----------------------------------------------------

test('S-chain: a bottom-rung implementer that finds G, then G2, resumes past both sign-offs on its rung — never climbed', async () => {
  const script = {
    [`implement:${SLUG}`]: gated([G]),
    [`implement:${SLUG} signed`]: gated([G2]),
    [`implement:${SLUG} signed 2`]: green(`implement:${SLUG} signed 2`),
    [`review:${SLUG} r1`]: approve,
  }
  const { A, B, C } = await resumeTwiceAfterSignOff(mkArgs(), script, `implement:${SLUG} signed 2`)
  assert.deepEqual(A.labels, [`implement:${SLUG}`])
  assert.deepEqual([B.labels, B.row.gatedInputs], [[`implement:${SLUG}`, `implement:${SLUG} signed`], [G2]])
  assert.deepEqual(C.labels, [`implement:${SLUG}`, `implement:${SLUG} signed`, `implement:${SLUG} signed 2`, `review:${SLUG} r1`])
  assert.ok(C.labels.every((l) => !l.includes('@')), 'no takeover')
  assert.deepEqual([C.row.rung, C.row.climbs], [BOTTOM, []])
  assertContinuation(C, `implement:${SLUG}`, 1)
  assertContinuation(C, `implement:${SLUG}`, 2)
  noGateTextInPrompts(C, [G, G2])
})

test('S-chain-top: a top-rung implementer that finds G, then G2, resumes past both — never set aside blocked', async () => {
  const script = {
    [`implement:${SLUG}`]: gated([G]),
    [`implement:${SLUG} signed`]: gated([G2]),
    [`implement:${SLUG} signed 2`]: green(`implement:${SLUG} signed 2`),
    [`review:${SLUG} r1`]: approve,
  }
  const { C } = await resumeTwiceAfterSignOff(mkArgs({ rung: TOP }), script, `implement:${SLUG} signed 2`)
  assert.deepEqual(C.labels, [`implement:${SLUG}`, `implement:${SLUG} signed`, `implement:${SLUG} signed 2`, `review:${SLUG} r1`])
  assert.deepEqual([C.row.rung, C.row.climbs], [TOP, []])
  assertContinuation(C, `implement:${SLUG}`, 2)
  noGateTextInPrompts(C, [G, G2])
})

test('S-chain-retry: the retry after a climb finds G, then G2 — C resumes past both on the reached rung', async () => {
  const script = {
    [`implement:${SLUG}`]: red,
    [`implement:${SLUG}@${TOP}`]: gated([G]),
    [`implement:${SLUG}@${TOP} signed`]: gated([G2]),
    [`implement:${SLUG}@${TOP} signed 2`]: green(`implement:${SLUG}@${TOP} signed 2`),
    [`review:${SLUG} r1`]: approve,
  }
  const { C } = await resumeTwiceAfterSignOff(mkArgs(), script, `implement:${SLUG}@${TOP} signed 2`)
  assert.deepEqual(C.labels, [`implement:${SLUG}`, `implement:${SLUG}@${TOP}`, `implement:${SLUG}@${TOP} signed`, `implement:${SLUG}@${TOP} signed 2`, `review:${SLUG} r1`])
  assert.deepEqual([C.row.rung, C.row.climbs], [TOP, [{ stage: 'implement', from: BOTTOM, to: TOP }]])
  assertContinuation(C, `implement:${SLUG}@${TOP}`, 2)
  noGateTextInPrompts(C, [G, G2])
})

test("S-chain-revise: an own run's reviser that finds G, then G2, resumes past both, then the judge", async () => {
  const script = {
    [`implement:${SLUG}`]: green(`implement:${SLUG}`),
    [`review:${SLUG} r1`]: changes('handle the empty corpus'),
    [`revise:${SLUG} r2`]: gated([G]),
    [`revise:${SLUG} r2 signed`]: gated([G2]),
    [`revise:${SLUG} r2 signed 2`]: green(`revise:${SLUG} r2 signed 2`),
    [`review:${SLUG} r2`]: approve,
  }
  const { B, C } = await resumeTwiceAfterSignOff(mkArgs({ rung: TOP }), script, `revise:${SLUG} r2 signed 2`)
  assert.deepEqual(B.row.gatedInputs, [G2])
  assert.deepEqual(C.labels, [`implement:${SLUG}`, `review:${SLUG} r1`, `revise:${SLUG} r2`, `revise:${SLUG} r2 signed`, `revise:${SLUG} r2 signed 2`, `review:${SLUG} r2`])
  assert.equal(C.row.reviewRoundsUsed, 2)
  assertContinuation(C, `revise:${SLUG} r2`, 2)
  noGateTextInPrompts(C, [G, G2])
})

test('S-chain-seeded: a seeded revise that finds G, then G2, resumes past both, then the judge', async () => {
  const resume = { stage: 'revise', prUrl: PR, branch: BR, worktreePath: WT, reviewHistory: [{ round: 1, feedback: ['keep their rename'], stage: 'integration' }], reviewRoundsUsed: 1, plan: '' }
  const script = {
    [`revise:${SLUG} r2`]: gated([G]),
    [`revise:${SLUG} r2 signed`]: gated([G2]),
    [`revise:${SLUG} r2 signed 2`]: green(`revise:${SLUG} r2 signed 2`),
    [`review:${SLUG} r2`]: approve,
  }
  const { C } = await resumeTwiceAfterSignOff(mkArgs({ rung: TOP, resume }), script, `revise:${SLUG} r2 signed 2`)
  assert.deepEqual(C.labels, [`revise:${SLUG} r2`, `revise:${SLUG} r2 signed`, `revise:${SLUG} r2 signed 2`, `review:${SLUG} r2`])
  assert.ok(C.calls[2].prompt.includes('COLD ENTRY'), 'the second continuation keeps the cold entry')
  assertContinuation(C, `revise:${SLUG} r2`, 2)
})

// ---- 4. the E1/E2 bounds: one continuation per approved gate per site, unapproved stops untouched ----

test('E1: a fresh run whose implementer stops for already-approved gates gets a continuation', async () => {
  const r = await run(mkArgs({ approvedGates: [G] }), {
    [`implement:${SLUG}`]: gated([G]),
    [`implement:${SLUG} signed`]: green(`implement:${SLUG} signed`),
    [`review:${SLUG} r1`]: approve,
  })
  clean(r)
  assert.deepEqual(r.labels, [`implement:${SLUG}`, `implement:${SLUG} signed`, `review:${SLUG} r1`])
  assert.deepEqual([r.row.status, r.row.rung, r.row.climbs], ['review', BOTTOM, []])
  assert.ok(r.logs.some((l) => l.includes(`implement:${SLUG}`) && /signed off/.test(l)), r.logs.join('\n'))
})

test('E1: a fresh run whose implementer finds two approved gates in turn gets a continuation past each', async () => {
  const r = await run(mkArgs({ approvedGates: [G, G2] }), {
    [`implement:${SLUG}`]: gated([G]),
    [`implement:${SLUG} signed`]: gated([G2]),
    [`implement:${SLUG} signed 2`]: green(`implement:${SLUG} signed 2`),
    [`review:${SLUG} r1`]: approve,
  })
  clean(r)
  assert.deepEqual(r.labels, [`implement:${SLUG}`, `implement:${SLUG} signed`, `implement:${SLUG} signed 2`, `review:${SLUG} r1`])
  assert.deepEqual([r.row.status, r.row.rung, r.row.climbs], ['review', BOTTOM, []])
})

test('E1: a repeat signed stop for a gate already passed takes the old path — a climb below the top, a same-rung retry on it — never a loop', async () => {
  const bottom = await run(mkArgs({ approvedGates: [G] }), {
    [`implement:${SLUG}`]: gated([G]),
    [`implement:${SLUG} signed`]: gated([G]),
    [`implement:${SLUG}@${TOP}`]: green(`implement:${SLUG}@${TOP}`),
    [`review:${SLUG} r1`]: approve,
  })
  clean(bottom)
  assert.deepEqual(bottom.labels, [`implement:${SLUG}`, `implement:${SLUG} signed`, `implement:${SLUG}@${TOP}`, `review:${SLUG} r1`])
  assert.deepEqual([bottom.row.status, bottom.row.climbs], ['review', [{ stage: 'implement', from: BOTTOM, to: TOP }]])

  // on the top rung the climb is a recorded no-op and the same rung retries once (CAPPED_RETRY_ITERATIONS);
  // the retry is its own site: it continues past G once there too, then a repeat G blocks
  const top = await run(mkArgs({ rung: TOP, approvedGates: [G] }), {
    [`implement:${SLUG}`]: gated([G]),
    [`implement:${SLUG} signed`]: gated([G]),
    [`implement:${SLUG}@${TOP}`]: gated([G]),
    [`implement:${SLUG}@${TOP} signed`]: gated([G]),
  })
  clean(top)
  assert.deepEqual(top.labels, [`implement:${SLUG}`, `implement:${SLUG} signed`, `implement:${SLUG}@${TOP}`, `implement:${SLUG}@${TOP} signed`])
  assert.ok(top.calls[2].prompt.includes('Max iterations: 2') && top.calls[2].prompt.includes('SECOND PASS'), 'a same-rung second pass at the reduced budget')
  assert.deepEqual([top.row.status, top.row.climbs], ['blocked', [{ stage: 'implement', from: TOP, to: TOP }]])

  // below the top, the retry after the climb is its own site too: past G once there, then a repeat G blocks
  const retry = await run(mkArgs({ approvedGates: [G] }), {
    [`implement:${SLUG}`]: gated([G]),
    [`implement:${SLUG} signed`]: gated([G]),
    [`implement:${SLUG}@${TOP}`]: gated([G]),
    [`implement:${SLUG}@${TOP} signed`]: gated([G]),
  })
  clean(retry)
  assert.deepEqual(retry.labels, [`implement:${SLUG}`, `implement:${SLUG} signed`, `implement:${SLUG}@${TOP}`, `implement:${SLUG}@${TOP} signed`])
  assert.equal(retry.row.status, 'blocked')
})

test('E1: continuations are bounded by the distinct approved gates — a stop that repeats only passed gates takes the old path', async () => {
  // G, then G2, then G again: two continuations (one per approved gate), then the old path (on the top rung,
  // the same-rung retry, which here blocks plainly).
  const again = await run(mkArgs({ rung: TOP, approvedGates: [G, G2] }), {
    [`implement:${SLUG}`]: gated([G]),
    [`implement:${SLUG} signed`]: gated([G2]),
    [`implement:${SLUG} signed 2`]: gated([G]),
    [`implement:${SLUG}@${TOP}`]: plainBlock,
  })
  clean(again)
  assert.deepEqual(again.labels, [`implement:${SLUG}`, `implement:${SLUG} signed`, `implement:${SLUG} signed 2`, `implement:${SLUG}@${TOP}`])
  assert.equal(again.row.status, 'blocked')
  // both gates at once, then both again: one continuation, then the old path (a climb below the top).
  const both = await run(mkArgs({ approvedGates: [G, G2] }), {
    [`implement:${SLUG}`]: gated([G, G2]),
    [`implement:${SLUG} signed`]: gated([G2, G]),
    [`implement:${SLUG}@${TOP}`]: green(`implement:${SLUG}@${TOP}`),
    [`review:${SLUG} r1`]: approve,
  })
  clean(both)
  assert.deepEqual(both.labels, [`implement:${SLUG}`, `implement:${SLUG} signed`, `implement:${SLUG}@${TOP}`, `review:${SLUG} r1`])
  assert.deepEqual([both.row.status, both.row.climbs.length], ['review', 1])
  // a gate worded differently only in case/whitespace is the same gate: no second continuation for it.
  const reworded = await run(mkArgs({ rung: TOP, approvedGates: [G] }), {
    [`implement:${SLUG}`]: gated([G]),
    [`implement:${SLUG} signed`]: gated([`  ${G.toUpperCase()} `]),
    [`implement:${SLUG}@${TOP}`]: plainBlock,
  })
  clean(reworded)
  assert.deepEqual(reworded.labels, [`implement:${SLUG}`, `implement:${SLUG} signed`, `implement:${SLUG}@${TOP}`])
  assert.equal(reworded.row.status, 'blocked')
})

test('E2: a reviser continues past each approved gate once; a repeat signed stop for a passed gate blocks', async () => {
  const r = await run(mkArgs({ rung: TOP, approvedGates: [G] }), {
    [`implement:${SLUG}`]: green(`implement:${SLUG}`),
    [`review:${SLUG} r1`]: changes('handle the empty corpus'),
    [`revise:${SLUG} r2`]: gated([G]),
    [`revise:${SLUG} r2 signed`]: gated([G]),
  })
  clean(r)
  assert.deepEqual(r.labels, [`implement:${SLUG}`, `review:${SLUG} r1`, `revise:${SLUG} r2`, `revise:${SLUG} r2 signed`])
  assert.equal(r.row.status, 'blocked')

  const two = await run(mkArgs({ rung: TOP, approvedGates: [G, G2] }), {
    [`implement:${SLUG}`]: green(`implement:${SLUG}`),
    [`review:${SLUG} r1`]: changes('handle the empty corpus'),
    [`revise:${SLUG} r2`]: gated([G]),
    [`revise:${SLUG} r2 signed`]: gated([G2]),
    [`revise:${SLUG} r2 signed 2`]: gated([G2]),
  })
  clean(two)
  assert.deepEqual(two.labels, [`implement:${SLUG}`, `review:${SLUG} r1`, `revise:${SLUG} r2`, `revise:${SLUG} r2 signed`, `revise:${SLUG} r2 signed 2`])
  assert.equal(two.row.status, 'blocked')
})

test('E1/E2: an unapproved stop never gets a continuation — it goes to gate-pending, as gate C does', async () => {
  for (const [name, over, script, stop] of [
    ['implementer, nothing approved', {}, { [`implement:${SLUG}`]: gated([G]) }, `implement:${SLUG}`],
    ['implementer, a new gate beside an approved one', { approvedGates: [G] }, { [`implement:${SLUG}`]: gated([G, G2]) }, `implement:${SLUG}`],
    ['implementer, a changed cap', { approvedGates: [G] }, { [`implement:${SLUG}`]: gated([G.replace('30', '45')]) }, `implement:${SLUG}`],
    ['reviser', { rung: TOP, approvedGates: [G] }, {
      [`implement:${SLUG}`]: green(`implement:${SLUG}`), [`review:${SLUG} r1`]: changes('x'), [`revise:${SLUG} r2`]: gated([G2]),
    }, `revise:${SLUG} r2`],
  ]) {
    const r = await run(mkArgs(over), script)
    clean(r)
    assert.equal(r.row.status, 'gate-pending', name)
    assert.equal(r.labels[r.labels.length - 1], stop, name)
    assert.ok(r.labels.every((l) => !/ signed( \d+)?$/.test(l) && !l.includes('@')), `${name}: ${r.labels}`)
    // the gate stop itself never climbs: only the review judge's `changes` before the reviser's stop did
    assert.deepEqual(r.row.climbs.map((c) => c.stage), name === 'reviser' ? ['review'] : [], name)
  }
})

test('the continuation is wired at its three production sites, and integrate has none', () => {
  const src = fs.readFileSync(enginePath, 'utf8')
  const code = src.replace(/\/\/[^\n]*/g, '')
  assert.equal((code.match(/\bpastSignedGates\(/g) || []).length, 4, 'three calls plus the definition')
  const integrate = code.slice(code.indexOf('async function integrate('), code.indexOf('function integrationResult('))
  assert.ok(integrate.length > 0 && !integrate.includes('pastSignedGates'), 'integrate() has no continuation')
  assert.equal(typeof SG, 'string')
  assert.ok(!/approvedGates/.test(SG) && SG.includes('## Approved gates'), 'the block names the note section, never the arg')
})
