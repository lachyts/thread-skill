// Execute the complete pinned workflow, replacing only the native agent boundary.
// Capability strings below are fixture evidence, never live harness proof.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'

const source = fs.readFileSync(new URL('../wave-execute.workflow.js', import.meta.url), 'utf8')
  .replace('export const meta', 'const meta')
const normal = 'claude-opus-5-5'
const recovery = 'claude-fable-5-1'
const head = 'b'.repeat(40)
// The repository-only run uses a deterministic boundary fixture. Set NATIVE_ROUTING_MODULE
// to the candidate shared resolver to test the real policy/engine contract as well.
const nativeRouting = process.env.NATIVE_ROUTING_MODULE
  ? await import(pathToFileURL(process.env.NATIVE_ROUTING_MODULE).href) : null
const digest = nativeRouting?.ROUTING_POLICY_DIGEST || 'c'.repeat(64)
const efforts = ['low', 'medium', 'high', 'xhigh', 'max']
const policy = (overrides = {}) => ({ version: 1, policyDigest: digest, harness: 'claude',
  normal: { model: normal, supportedEfforts: efforts }, recovery: { model: recovery, supportedEfforts: efforts },
  startingEffort: 'high', reviewerFloor: 'xhigh', exactModel: false,
  capabilities: { harness: 'claude', verified: true, source: 'native-capability-preflight',
    evidence: 'TEST FIXTURE ONLY', models: {
      [normal]: { supportedEfforts: efforts }, [recovery]: { supportedEfforts: efforts },
    } }, ...overrides })
const task = { slug: 'routing-task', taskPath: '/adopted/routing-task.md', scope: 'single-file',
  planGate: false, maxIterations: 3, maxPlanRounds: 3, maxReviewRounds: 3 }
const green = { verified: true, verifiedHead: head, blocked: false, escalate: false,
  prUrl: 'https://github.com/fixture/repo/pull/1', branch: 'audit-fix/task',
  worktreePath: '/fixture/worktree', blockerDiagnosis: '', summary: 'verified fixture' }
const red = { ...green, verified: false, verifiedHead: '', escalate: true,
  failureKind: 'quality', blockerDiagnosis: 'The new result is incorrect', summary: 'Partial work committed' }
const approve = { verdict: 'approve', feedback: [], reviewedHead: head }
const changes = { verdict: 'changes', feedback: ['Fix the missing sibling path'], reviewedHead: head }
const plan = { ready: true, blocked: false, blockerCause: '', plan: '### Gated inputs\nNone' }
const answer = (_p, o) => o.schema.properties.ready ? plan : o.schema.properties.verdict ? approve : green
const fixtureResolve = (p, intent) => {
  const count = intent.qualityFailures
  const alternative = count >= 2 && !p.exactModel
  const unavailable = intent.recoveryUnavailable
  if (unavailable !== undefined && (!alternative || !p.recovery || unavailable?.model !== p.recovery.model
    || typeof unavailable.evidence !== 'string' || !unavailable.evidence.trim()
    || Object.keys(unavailable).some(k => !['model', 'evidence'].includes(k)))) throw new Error('invalid recoveryUnavailable')
  const selected = alternative && !unavailable && p.recovery || p.normal
  const route = alternative ? p.recovery && !unavailable ? 'recovery' : 'maximum-unavailable' : count ? 'maximum' : 'normal'
  const effort = count ? selected.supportedEfforts.at(-1) : intent.role === 'review' ? p.reviewerFloor
    : intent.difficulty === 'hard' ? 'xhigh' : 'high'
  const profile = p.capabilities.profile
  if (profile && (profile.model !== undefined && profile.model !== selected.model || profile.effort !== undefined && profile.effort !== effort)) {
    throw new Error('Native profile conflicts with requested routing')
  }
  return { requested: intent, resolved: { harness: p.harness, model: selected.model, effort, policyDigest: p.policyDigest, route }, observed: null }
}
async function run({ config = {}, task: fields = {}, respond = answer, resolver = true } = {}) {
  const calls = []
  const ctx = { args: { protocolVersion: 4, baseBranch: 'main', baseRef: 'a'.repeat(40),
    authorisation: 'Fixture authority only', rolloutSlug: 'fixture-rollout', repoPath: '/fixture/repo',
    verifier: 'make test', routingPolicy: policy(), evidenceContractVersion: 1, harness: 'claude',
    waves: [{ wave: 1, tasks: [{ ...task, ...fields }] }], ...config },
    normaliseRoutingPolicy: nativeRouting?.normaliseRoutingPolicy || (p => p),
    resolveRouting: nativeRouting?.resolveRouting || fixtureResolve,
    log() {}, pipeline: async (items, fn) => Promise.all(items.map(fn)),
    agent: async (prompt, options) => { calls.push({ prompt, ...options }); return respond(prompt, options) } }
  vm.createContext(ctx)
  if (!resolver) { delete ctx.resolveRouting; delete ctx.normaliseRoutingPolicy }
  try { return { calls, result: JSON.parse(JSON.stringify(await vm.runInContext(`(async()=>{${source}\n})()`, ctx))) } }
  catch (error) { return { calls, error } }
}
const work = r => r.calls.filter(c => c.routing?.role === 'work')
const route = r => work(r).map(c => [c.model, c.effort])

const forkReview = { claudeReviewProtocol: 'claude-fork-v1', evidenceContractVersion: 2 }
const verifierContract = { version: 1, baselineModes: ['repository-valid'] }

test('Claude fork review requires its explicit native policy and evidence contract before dispatch', async () => {
  for (const config of [
    { ...forkReview, claudeReviewProtocol: 'unknown' },
    { ...forkReview, routingPolicy: undefined },
    { ...forkReview, harness: undefined },
    { ...forkReview, harness: 'codex' },
    { ...forkReview, evidenceContractVersion: 1 },
    { ...forkReview, evidenceContractVersion: '2' },
    { ...forkReview, evidenceContractVersion: 2.5 },
    { ...forkReview, protocolVersion: 3 },
  ]) {
    const r = await run({ config })
    assert.ok(r.error, JSON.stringify(config))
    assert.equal(r.calls.length, 0)
  }
})

test('Claude fork wrappers use every exact resolved binding and retain all verbatim findings', async () => {
  const findings = Array.from({ length: 11 }, (_, i) => `VERBATIM native finding ${i + 1}: preserve punctuation [${i}].`)
  let reviews = 0
  const r = await run({ config: forkReview, respond: (p, o) => o.label.startsWith('review:')
    ? ++reviews < 3 ? { ...changes, feedback: findings } : approve : answer(p, o) })
  assert.ifError(r.error)
  const wrappers = r.calls.filter(c => c.label.startsWith('review:'))
  assert.deepEqual(wrappers.map(c => [c.model, c.effort]), [[normal, 'xhigh'], [normal, 'max'], [recovery, 'max']])
  for (const wrapper of wrappers) {
    assert.equal(wrapper.reviewContract.protocol, 'claude-fork-v1')
    assert.equal(wrapper.reviewContract.reviewedHead, head)
    assert.equal(wrapper.reviewContract.level, 'xhigh')
    assert.match(wrapper.prompt, new RegExp(`model=${wrapper.model}; reasoning effort=${wrapper.effort}`))
    assert.match(wrapper.prompt, /Skill-capable native definition/)
    assert.match(wrapper.prompt, /unmodified.*\/code-review xhigh.*EXACTLY ONCE/)
    assert.match(wrapper.prompt, /same-child messaging/)
    assert.match(wrapper.prompt, /VERBATIM findings/)
    assert.match(wrapper.prompt, /launched.*not completion/i)
    assert.match(wrapper.prompt, /Do not.*(?:re-review|another review)/)
    assert.match(wrapper.prompt, /actual fork.*separately observed/i)
    assert.doesNotMatch(wrapper.prompt, /3–8|Read `gh pr diff|Apply the discipline/)
    assert.deepEqual(Object.keys(wrapper.schema.properties).sort(), ['feedback', 'reviewedHead', 'verdict'])
  }
  assert.equal(r.result.tasks[0].status, 'review')
  assert.deepEqual(r.result.tasks[0].reviewHistory.map(x => x.feedback), [findings, findings])
  assert.ok(r.calls.filter(c => c.label.startsWith('revise:')).every(c => findings.every(f => c.prompt.includes(f))))
})

test('an asynchronous native fork leaves the same wrapper pending until findings arrive', async () => {
  let relay
  let wrapperStarted
  let finished = false
  const started = new Promise(resolve => { wrapperStarted = resolve })
  const delivered = new Promise(resolve => { relay = resolve })
  const pending = run({ config: forkReview, respond: async (p, o) => {
    if (o.label.startsWith('review:')) { wrapperStarted(); return delivered }
    return answer(p, o)
  } }).then(r => { finished = true; return r })
  // A rejected preflight must also release the test, so the red witness cannot hang.
  const first = await Promise.race([started.then(() => 'started'), pending.then(() => 'finished')])
  assert.equal(first, 'started')
  assert.equal(finished, false)
  relay(approve)
  const r = await pending
  assert.ifError(r.error)
  assert.equal(r.calls.filter(c => c.label.startsWith('review:')).length, 1)
  assert.match(r.calls.at(-1).prompt, /Do not.*fabricated verdict/)
  assert.match(r.calls.at(-1).prompt, /pending.*wait/i)
  assert.equal(r.result.tasks[0].status, 'review')
})

test('a fork launch acknowledgement cannot become approval or another quality correction', async () => {
  const r = await run({ config: forkReview, respond: (p, o) => o.label.startsWith('review:')
    ? { status: 'launched', forkId: 'FIXTURE-NOT-LIVE' } : answer(p, o) })
  assert.ifError(r.error)
  assert.equal(r.result.tasks[0].status, 'blocked')
  assert.equal(r.result.tasks[0].routingState.qualityFailures, 0)
  assert.equal(r.calls.length, 2)
})

test('unflagged native and pinned legacy review requests do not acquire the fork protocol', async () => {
  for (const config of [{}, { routingPolicy: undefined },
    { routingPolicy: undefined, evidenceContractVersion: undefined },
    { routingPolicy: undefined, harness: 'codex' }]) {
    const r = await run({ config })
    assert.ifError(r.error)
    const review = r.calls.find(c => c.label.startsWith('review:'))
    assert.equal(review.reviewContract?.protocol, undefined)
    assert.doesNotMatch(review.prompt, /claude-fork-v1|same-child messaging|VERBATIM findings/)
    assert.match(review.prompt, /3–8 specific/)
  }
})

test('verifier modes bind implementation, approved-plan work, revisions and reviews to the task candidate', async () => {
  for (const planGate of [false, true]) {
    let reviews = 0
    const r = await run({ config: { verifierContract }, task: { planGate, verifierModes: ['task-a-complete', 'all-complete'] },
      respond: (p, o) => o.label.startsWith('review:') ? ++reviews === 1 ? changes : approve : answer(p, o) })
    assert.ifError(r.error)
    const candidates = r.calls.filter(c => /^(implement|revise|review):/.test(c.label))
    assert.equal(candidates.length, 4)
    for (const c of candidates) {
      assert.match(c.prompt, /JSON.*\{.*mode.*head/)
      assert.match(c.prompt, /task-a-complete/)
      assert.match(c.prompt, /all-complete/)
      assert.match(c.prompt, /repository-valid/)
      assert.match(c.prompt, /head.*(?:exact|match).*candidate/i)
      assert.match(c.prompt, /exit.?0.*(?:insufficient|not sufficient)/i)
      assert.match(c.prompt, /single verifier/)
    }
    assert.equal(r.result.tasks[0].status, 'review')
  }
})

test('invalid or unpaired verifier-mode contracts fail before any child', async () => {
  for (const verifierModes of [undefined, [], '', [''], ['  '], ['done', 1], null]) {
    const r = await run({ config: { verifierContract }, task: { verifierModes } })
    assert.ok(r.error, JSON.stringify(verifierModes))
    assert.equal(r.calls.length, 0)
  }
  for (const contract of [undefined, null, { version: 2, baselineModes: ['base'] },
    { version: 1, baselineModes: [] }, { version: 1, baselineModes: [' '] },
    { version: 1, baselineModes: 'base' }]) {
    const r = await run({ config: { verifierContract: contract }, task: { verifierModes: ['done'] } })
    assert.ok(r.error, JSON.stringify(contract))
    assert.equal(r.calls.length, 0)
  }
  const old = await run({ config: { protocolVersion: 3, routingPolicy: undefined,
    evidenceContractVersion: undefined, verifierContract }, task: { verifierModes: ['done'] } })
  assert.ok(old.error)
  assert.equal(old.calls.length, 0)
})

test('resumed routing and retained PR work keep verifier modes across bounded retries', async () => {
  const routingState = { version: 1, policyDigest: digest, qualityFailures: 1, stage: 'maximum',
    lastFailure: { layer: 'review', kind: 'quality', feedback: ['Preserved diagnosis'] } }
  let candidates = 0
  const r = await run({ config: { verifierContract }, task: { verifierModes: ['restored-task-complete'],
    routingState, priorResult: { ...green, reviewHistory: [{ round: 1, feedback: ['Preserved diagnosis'] }] } },
    respond: (p, o) => o.label.startsWith('implement:') ? ++candidates === 1 ? red : green : answer(p, o) })
  assert.ifError(r.error)
  assert.deepEqual(route(r), [[normal, 'max'], [recovery, 'max']])
  assert.equal(r.result.tasks[0].prUrl, green.prUrl)
  for (const call of r.calls) assert.match(call.prompt, /restored-task-complete/)
  assert.match(work(r)[1].prompt, /Preserved diagnosis/)
})

test('normal effort follows easy/hard policy and independent reviewers stay at xhigh', async () => {
  for (const startingEffort of ['high', 'xhigh']) {
    const r = await run({ config: { routingPolicy: policy({ startingEffort }) },
      task: { planGate: true, difficulty: startingEffort === 'high' ? 'easy' : 'hard' } })
    assert.ifError(r.error)
    assert.deepEqual(route(r), [[normal, startingEffort], [normal, startingEffort]])
    const judges = r.calls.filter(c => c.routing?.role === 'review')
    assert.equal(judges.length, 2)
    assert.ok(judges.every(c => c.effort === 'xhigh'))
    assert.equal(r.result.tasks[0].routingState.stage, 'normal')
  }
})

test('verification failures run same model maximum before optional recovery and preserve work', async () => {
  let passes = 0
  const r = await run({ respond: (_p, o) => o.label.startsWith('implement:') ? (++passes < 3 ? red : green) : approve })
  assert.ifError(r.error)
  assert.deepEqual(route(r), [[normal, 'high'], [normal, 'max'], [recovery, 'max']])
  assert.equal(r.result.tasks[0].status, 'review')
  assert.equal(r.result.tasks[0].routingState.qualityFailures, 2)
  assert.equal(r.result.tasks[0].routingState.stage, 'recovery')
  assert.equal(r.result.tasks[0].prUrl, green.prUrl)
  assert.match(work(r)[1].prompt, /Partial work committed/)
  assert.match(work(r)[2].prompt, /fixture\/worktree/)
  assert.ok(work(r).every(c => c.prompt.includes('EXACTLY ONCE')))
})

test('plan corrections and review corrections share one task routing ladder', async () => {
  let planJudges = 0
  let reviewJudges = 0
  const r = await run({ task: { planGate: true }, respond: (_p, o) => {
    if (o.label.startsWith('plan-judge:')) return ++planJudges === 1 ? changes : approve
    if (o.label.startsWith('review:')) return ++reviewJudges === 1 ? changes : approve
    return answer(_p, o)
  } })
  assert.ifError(r.error)
  assert.deepEqual(route(r), [[normal, 'xhigh'], [normal, 'max'], [normal, 'max'], [recovery, 'max']])
  assert.equal(r.result.tasks[0].routingState.qualityFailures, 2)
  assert.equal(r.result.tasks[0].reviewHistory.length, 1)
})

test('all review rounds retain feedback and never dispatch a correction after the final round', async () => {
  const r = await run({ respond: (_p, o) => o.label.startsWith('review:') ? changes : green })
  assert.ifError(r.error)
  assert.deepEqual(route(r), [[normal, 'high'], [normal, 'max'], [recovery, 'max']])
  assert.equal(r.calls.filter(c => c.label.startsWith('review:')).length, 3)
  assert.equal(r.result.tasks[0].reviewRoundsUsed, 3)
  assert.equal(r.result.tasks[0].reviewHistory.length, 3)
  assert.equal(r.result.tasks[0].status, 'review-blocked')
  assert.match(work(r)[2].prompt, /ANTI-REGRESSION/)
})

test('one-round plan and review ceilings persist next routing state without extra work', async () => {
  for (const planGate of [false, true]) {
    const r = await run({ task: { planGate, maxPlanRounds: 1, maxReviewRounds: 1 }, respond: (_p, o) =>
      o.schema.properties.verdict ? changes : answer(_p, o) })
    assert.ifError(r.error)
    assert.equal(work(r).length, 1)
    assert.equal(r.result.tasks[0].routingState.qualityFailures, 1)
    assert.equal(r.result.tasks[0].routingState.stage, 'maximum')
    assert.equal(r.result.tasks[0].model, normal, 'an unexecuted route is not model provenance')
  }
})

test('implementation verifier budget is shared across routing changes, including budget one', async () => {
  for (const maxIterations of [1, 2, 3, 4]) {
    const r = await run({ task: { maxIterations }, respond: () => red })
    assert.ifError(r.error)
    assert.equal(work(r).length, maxIterations)
    assert.equal(r.result.tasks[0].status, 'blocked')
    assert.equal(r.calls.filter(c => c.label.startsWith('review:')).length, 0)
    assert.equal(r.result.tasks[0].prUrl, green.prUrl)
  }
})

test('unavailable recovery stays at normal maximum within the same bound', async () => {
  const r = await run({ config: { routingPolicy: policy({ recovery: null }) }, respond: () => red })
  assert.ifError(r.error)
  assert.deepEqual(route(r), [[normal, 'high'], [normal, 'max'], [normal, 'max']])
  assert.equal(r.result.tasks[0].routingState.stage, 'maximum-unavailable')
  assert.equal(r.result.tasks[0].routingState.qualityFailures, 3)
})

test('exact native model request never silently switches to recovery', async () => {
  const r = await run({ config: { routingPolicy: policy({ exactModel: true }) }, respond: () => red })
  assert.ifError(r.error)
  assert.ok(work(r).every(c => c.model === normal && c.routing.exactModel === true))
  assert.deepEqual(route(r), [[normal, 'high'], [normal, 'max'], [normal, 'max']])
})

test('a durable routing state seeds later work without reusing model names as state', async () => {
  const routingState = { version: 1, policyDigest: digest, qualityFailures: 1, stage: 'maximum',
    lastFailure: { layer: 'review', kind: 'quality', feedback: ['Retained failure'] } }
  const r = await run({ task: { routingState } })
  assert.ifError(r.error)
  assert.deepEqual(route(r), [[normal, 'max']])
  assert.deepEqual(r.result.tasks[0].routingState, routingState)
  assert.match(work(r)[0].prompt, /Retained failure/)
})

test('malformed or foreign routing state rejects before dispatch', async () => {
  for (const routingState of [null, { version: 1, policyDigest: digest, qualityFailures: -1, stage: 'normal' },
    { version: 1, policyDigest: 'd'.repeat(64), qualityFailures: 1, stage: 'maximum' },
    { version: 1, policyDigest: digest, qualityFailures: 0, stage: 'recovery' }]) {
    const r = await run({ task: { routingState } })
    assert.ok(r.error)
    assert.equal(r.calls.length, 0)
  }
})

test('unknown blocks, infrastructure, quota, authority and schema failures never escalate', async () => {
  for (const failureKind of [undefined, 'infrastructure', 'authority', 'quota', 'schema']) {
    const r = await run({ respond: () => ({ ...red, escalate: false, blocked: true, failureKind }) })
    assert.ifError(r.error)
    assert.deepEqual(route(r), [[normal, 'high']])
    assert.equal(r.result.tasks[0].routingState.qualityFailures, 0)
    assert.equal(r.result.tasks[0].prUrl, green.prUrl)
  }
})

test('explicit resource failure overrides an erroneous escalation signal', async () => {
  const r = await run({ respond: () => ({ ...red, failureKind: 'quota' }) })
  assert.ifError(r.error)
  assert.equal(work(r).length, 1)
  assert.equal(r.result.tasks[0].routingState.qualityFailures, 0)
})

test('native non-success markers, dead children and invalid replies do not count as quality', async () => {
  for (const reply of [null, { __failureKind: 'infrastructure', blockerDiagnosis: 'Native child stopped' },
    { unexpected: 'schema formatting failure' }]) {
    const r = await run({ respond: () => reply })
    assert.ifError(r.error)
    assert.equal(r.result.tasks[0].status, 'blocked')
    assert.equal(r.result.tasks[0].routingState.qualityFailures, 0)
    assert.ok(work(r).every(c => c.model === normal && c.effort === 'high'))
  }
})

test('gates and absent/stale review evidence pause without quality escalation', async () => {
  const gated = await run({ respond: () => ({ ...red, blocked: true, gatedInputs: ['spend: service cap $1'] }) })
  assert.ifError(gated.error)
  assert.equal(gated.result.tasks[0].status, 'gate-pending')
  assert.equal(gated.result.tasks[0].routingState.qualityFailures, 0)
  for (const reviewedHead of ['', 'e'.repeat(40)]) {
    const r = await run({ respond: (_p, o) => o.label.startsWith('review:') ? { ...changes, reviewedHead } : green })
    assert.ifError(r.error)
    assert.equal(r.result.tasks[0].status, 'review-blocked')
    assert.equal(r.result.tasks[0].routingState.qualityFailures, 0)
    assert.equal(work(r).length, 1)
  }
})

test('failed correction retains prior PR, branch, worktree and every feedback round', async () => {
  const r = await run({ respond: (_p, o) => o.label.startsWith('review:') ? changes
    : o.label.startsWith('revise:') ? { ...red, failureKind: 'infrastructure', prUrl: '', branch: '', worktreePath: '' } : green })
  assert.ifError(r.error)
  assert.equal(r.result.tasks[0].status, 'blocked')
  assert.equal(r.result.tasks[0].prUrl, green.prUrl)
  assert.equal(r.result.tasks[0].branch, green.branch)
  assert.equal(r.result.tasks[0].worktreePath, green.worktreePath)
  assert.deepEqual(r.result.tasks[0].reviewHistory, [{ round: 1, feedback: changes.feedback }])
  assert.equal(r.result.tasks[0].routingState.qualityFailures, 1)
})

test('new review contracts require the actual built-in and keep receipts outside unchanged verdicts', async () => {
  for (const harness of ['claude', 'codex']) {
    const routingPolicy = harness === 'claude' ? policy() : policy({ harness: 'codex',
      normal: { model: 'gpt-fixture', supportedEfforts: efforts }, recovery: null,
      capabilities: { ...policy().capabilities, harness: 'codex', models: { 'gpt-fixture': { supportedEfforts: efforts } } } })
    const r = await run({ config: { harness, routingPolicy } })
    assert.ifError(r.error)
    const review = r.calls.find(c => c.label.startsWith('review:'))
    assert.match(review.prompt, harness === 'claude' ? /invoke.*\/code-review xhigh/i : /bundled.*review-agent/i)
    assert.match(review.prompt, /independent native child/i)
    assert.match(review.prompt, /outside.*verdict/i)
    assert.match(review.prompt, /invocation evidence/i)
    assert.match(review.prompt, /reasoning effort.*separate/i)
    assert.doesNotMatch(review.prompt, /\/code-review ultra/)
    assert.deepEqual(Object.keys(review.schema.properties).sort(), ['feedback', 'reviewedHead', 'verdict'])
  }
})

test('evidenceContractVersion enables native built-in review without opting legacy routing in', async () => {
  const r = await run({ config: { routingPolicy: undefined } })
  assert.ifError(r.error)
  assert.match(r.calls.find(c => c.label.startsWith('review:')).prompt, /invoke.*\/code-review xhigh/i)
  assert.equal(r.calls[0].model, 'opus')
  assert.equal(r.calls[0].effort, 'medium')
  assert.equal(r.result.tasks[0].routingState, undefined)
})

test('legacy no-policy execution retains its original direct Fable escalation', async () => {
  let passes = 0
  const r = await run({ config: { routingPolicy: undefined, evidenceContractVersion: undefined },
    respond: (_p, o) => o.label.startsWith('implement:') ? (++passes === 1 ? red : green) : approve })
  assert.ifError(r.error)
  assert.deepEqual(r.calls.filter(c => c.label.startsWith('implement:')).map(c => [c.model, c.effort]),
    [['opus', 'medium'], ['fable', 'high']])
  assert.equal(r.result.tasks[0].routingState, undefined)
  assert.doesNotMatch(r.calls.find(c => c.label.startsWith('review:')).prompt, /invocation evidence/)
})

test('failed maximum-effort review correction can use recovery only within remaining rounds', async () => {
  for (const maxReviewRounds of [2, 3]) {
    let reviewed = 0
    let revised = 0
    const r = await run({ task: { maxReviewRounds }, respond: (_p, o) => {
      if (o.label.startsWith('review:')) return ++reviewed === 1 ? changes : approve
      if (o.label.startsWith('revise:')) return ++revised === 1 ? red : green
      return green
    } })
    assert.ifError(r.error)
    assert.equal(work(r).length, maxReviewRounds)
    assert.equal(r.result.tasks[0].routingState.qualityFailures, 2)
    assert.equal(r.result.tasks[0].status, maxReviewRounds === 2 ? 'blocked' : 'review')
    assert.equal(r.result.tasks[0].reviewRoundsUsed, maxReviewRounds)
    if (maxReviewRounds === 3) assert.deepEqual(route(r), [[normal, 'high'], [normal, 'max'], [recovery, 'max']])
  }
})

test('plan rejection exhausts exactly its existing candidate rounds and retains history', async () => {
  const r = await run({ task: { planGate: true }, respond: (_p, o) => o.label.startsWith('plan-judge:') ? changes : plan })
  assert.ifError(r.error)
  assert.deepEqual(route(r), [[normal, 'xhigh'], [normal, 'max'], [recovery, 'max']])
  assert.equal(r.result.tasks[0].planRoundsUsed, 3)
  assert.equal(r.result.tasks[0].planHistory.length, 3)
  assert.equal(r.result.tasks[0].status, 'plan-blocked')
})

test('native supported maximum is selected instead of assuming the label max', async () => {
  const supportedEfforts = efforts.slice(0, -1)
  const r = await run({ config: { routingPolicy: policy({ normal: { model: normal, supportedEfforts },
    recovery: { model: recovery, supportedEfforts }, capabilities: { ...policy().capabilities, models: {
      [normal]: { supportedEfforts }, [recovery]: { supportedEfforts },
    } } }) }, respond: () => red })
  assert.ifError(r.error)
  assert.deepEqual(route(r), [[normal, 'high'], [normal, 'xhigh'], [recovery, 'xhigh']])
})

test('missing pinned resolver refuses policy execution before any native child', async () => {
  const r = await run({ resolver: false })
  assert.match(r.error?.message || '', /pinned native routing resolver/)
  assert.equal(r.calls.length, 0)
  const legacy = await run({ resolver: false, config: { routingPolicy: undefined, evidenceContractVersion: undefined } })
  assert.ifError(legacy.error)
  assert.equal(legacy.result.tasks[0].status, 'review')
})

test('new-policy failure classification stays out of legacy implementation and judge schemas', async () => {
  const r = await run({ task: { planGate: true } })
  assert.ifError(r.error)
  assert.ok(work(r).every(c => c.schema.properties.failureKind))
  assert.ok(r.calls.filter(c => c.routing?.role === 'review').every(c => !c.schema.properties.failureKind))
  const legacy = await run({ task: { planGate: true }, config: { routingPolicy: undefined } })
  assert.ok(legacy.calls.every(c => !c.schema.properties.failureKind))
})

test('formatting-only plan failures and explicit resource blocks do not trigger the ladder', async () => {
  for (const result of [{ ...plan, plan: 'Missing required section' },
    ...['infrastructure', 'authority', 'quota', 'schema'].map(failureKind => ({ ...plan, ready: false, blocked: true, failureKind }))]) {
    const r = await run({ task: { planGate: true }, respond: () => result })
    assert.ifError(r.error)
    assert.equal(r.calls.length, 1)
    assert.equal(r.result.tasks[0].routingState.qualityFailures, 0)
    assert.equal(r.result.tasks[0].status, 'plan-blocked')
  }
})

test('new-policy counters report bounded candidates without claiming observed native settings', async () => {
  let reviews = 0
  const r = await run({ respond: (_p, o) => o.label.startsWith('review:') ? (++reviews === 1 ? changes : approve) : green })
  assert.ifError(r.error)
  assert.equal(r.result.tasks[0].verifierCandidatesUsed, 2)
  assert.equal(r.result.tasks[0].requestedProfile.model, normal)
  assert.equal(r.result.tasks[0].requestedProfile.effort, 'max')
  assert.equal(r.result.tasks[0].observed, undefined)
  const contract = r.calls.find(c => c.label.startsWith('review:')).reviewContract
  assert.deepEqual(JSON.parse(JSON.stringify(contract)), { engine: 'claude-code-review', level: 'xhigh', reviewedHead: head })
})

test('new policy and native evidence contracts require protocol4 while unflagged protocol3 remains valid', async () => {
  for (const config of [{ protocolVersion: 3 }, { protocolVersion: 3, routingPolicy: undefined }]) {
    const r = await run({ config })
    assert.match(r.error?.message || '', /protocolVersion 4/)
    assert.equal(r.calls.length, 0)
  }
  const legacy = await run({ config: { protocolVersion: 3, routingPolicy: undefined, evidenceContractVersion: undefined } })
  assert.ifError(legacy.error)
  assert.equal(legacy.result.tasks[0].status, 'review')
})

test('malformed quality replies cannot spend correction allowance or change routing state', async () => {
  for (const result of [{ ...red, verified: 'false' }, { ...red, branch: null }, { ...red, gatedInputs: 'a gate' },
    { ...red, failureKind: 'unknown' }]) {
    const r = await run({ respond: () => result })
    assert.ifError(r.error)
    assert.equal(r.calls.length, 1)
    assert.equal(r.result.tasks[0].status, 'blocked')
    assert.equal(r.result.tasks[0].routingState.qualityFailures, 0)
  }
})

test('durable routing failure evidence must be well formed before any dispatch', async () => {
  for (const lastFailure of [null, { kind: 'quality', layer: 'review', feedback: 'invalid' },
    { kind: 'quota', layer: 'review', feedback: ['not quality'] }]) {
    const r = await run({ task: { routingState: { version: 1, policyDigest: digest, qualityFailures: 1, stage: 'maximum', lastFailure } } })
    assert.ok(r.error)
    assert.equal(r.calls.length, 0)
  }
})

test('a contradictory pinned native profile fails before partial work can be lost on escalation', async () => {
  const r = await run({ config: { routingPolicy: policy({ capabilities: { ...policy().capabilities, profile: { model: normal } } }) },
    respond: () => red })
  assert.match(r.error?.message || '', /profile/)
  assert.equal(r.calls.length, 0)
})

test('a thrown native resource boundary preserves already-earned routing and partial work', async () => {
  let candidates = 0
  const r = await run({ respond: () => {
    if (++candidates === 1) return red
    throw new Error('NativeWorkflowIncomplete: child blocked: quota unavailable')
  } })
  assert.ifError(r.error)
  assert.equal(r.calls.length, 2)
  assert.equal(r.result.tasks[0].status, 'blocked')
  assert.equal(r.result.tasks[0].routingState.stage, 'maximum')
  assert.equal(r.result.tasks[0].routingState.qualityFailures, 1)
  assert.equal(r.result.tasks[0].prUrl, green.prUrl)
  assert.match(r.result.tasks[0].blockerDiagnosis, /quota unavailable/)
})

test('cross-cutting and plan-gated tasks automatically start hard unless explicitly classified', async () => {
  for (const fields of [{ scope: 'cross-cutting' }, { planGate: true }]) {
    const r = await run({ task: fields })
    assert.ifError(r.error)
    assert.ok(work(r).every(c => c.effort === 'xhigh' && c.routing.difficulty === 'hard'))
    const explicit = await run({ task: { ...fields, difficulty: 'easy' } })
    assert.ifError(explicit.error)
    assert.ok(work(explicit).every(c => c.effort === 'high' && c.routing.difficulty === 'easy'))
  }
})

test('new-policy execution rejects legacy overrides rather than silently ignoring intent', async () => {
  for (const [key, value] of [['maxTier', 'opus'], ['maxTier', 'fable'], ['judgeModel', 'fable'], ['model', 'opus'], ['effort', 'max']]) {
    const r = await run({ config: { [key]: value } })
    assert.match(r.error?.message || '', /legacy.*routingPolicy/i)
    assert.equal(r.calls.length, 0)
  }
  for (const fields of [{ model: 'opus' }, { model: normal }, { effort: 'max' }]) {
    const r = await run({ task: fields })
    assert.match(r.error?.message || '', /legacy.*routingPolicy/i)
    assert.equal(r.calls.length, 0)
  }
})

const unavailableProof = { model: recovery, evidence: 'TEST FIXTURE native launch refused prepared recovery model' }
const recoveryState = () => ({ version: 1, policyDigest: digest, qualityFailures: 2, stage: 'recovery',
  lastFailure: { layer: 'implement', kind: 'quality', feedback: ['Two substantive failures; preserve the committed work'] } })
function unavailable(proof = unavailableProof) {
  const error = new Error('NativeWorkflowIncomplete: recovery model unavailable')
  error.modelUnavailable = proof
  throw error
}

test('typed recovery unavailability falls back at normal maximum only in the next existing candidate', async () => {
  for (const maxIterations of [3, 4]) {
    let candidates = 0
    const r = await run({ task: { maxIterations }, respond: (_p, o) => {
      if (!o.label.startsWith('implement:')) return approve
      if (++candidates < 3) return red
      if (candidates === 3) unavailable()
      return green
    } })
    assert.ifError(r.error)
    assert.equal(work(r).length, maxIterations)
    assert.equal(r.result.tasks[0].status, maxIterations === 3 ? 'blocked' : 'review')
    assert.equal(r.result.tasks[0].routingState.qualityFailures, 2)
    assert.equal(r.result.tasks[0].routingState.stage, 'maximum-unavailable')
    assert.deepEqual(r.result.tasks[0].routingState.recoveryUnavailable, unavailableProof)
    assert.equal(r.result.tasks[0].prUrl, green.prUrl)
    if (maxIterations === 4) assert.deepEqual(route(r), [[normal, 'high'], [normal, 'max'], [recovery, 'max'], [normal, 'max']])
  }
})

test('persisted runtime unavailability survives later attempt and further quality failures', async () => {
  const routingState = { ...recoveryState(), stage: 'maximum-unavailable', recoveryUnavailable: unavailableProof }
  let attempts = 0
  const r = await run({ task: { routingState, maxIterations: 2 }, respond: (_p, o) =>
    o.label.startsWith('implement:') ? (++attempts === 1 ? red : green) : approve })
  assert.ifError(r.error)
  assert.deepEqual(route(r), [[normal, 'max'], [normal, 'max']])
  assert.deepEqual(r.result.tasks[0].routingState.recoveryUnavailable, unavailableProof)
  assert.equal(r.result.tasks[0].routingState.qualityFailures, 3)
  assert.ok(work(r).every(c => c.routing.recoveryUnavailable?.model === recovery))
})

test('generic recovery resource failures and invalid typed proof never cause model hopping', async () => {
  for (const respond of [() => { throw new Error('Fable unavailable: quota or permission unknown') },
    () => unavailable({ model: normal, evidence: 'Wrong model' }), () => unavailable({ model: recovery, evidence: '' }),
    () => ({ ...red, failureKind: 'quota', modelUnavailable: unavailableProof })]) {
    const r = await run({ task: { routingState: recoveryState() }, respond })
    assert.ifError(r.error)
    assert.equal(work(r).length, 1)
    assert.equal(r.result.tasks[0].status, 'blocked')
    assert.equal(r.result.tasks[0].routingState.qualityFailures, 2)
    assert.equal(r.result.tasks[0].routingState.recoveryUnavailable, undefined)
  }
  const wrongStage = await run({ respond: () => unavailable() })
  assert.ifError(wrongStage.error)
  assert.equal(work(wrongStage).length, 1)
  assert.equal(wrongStage.result.tasks[0].routingState.recoveryUnavailable, undefined)
})

test('unavailable reviewer consumes its round and reuses verified work at normal maximum', async () => {
  for (const maxReviewRounds of [1, 2]) {
    let reviews = 0
    const r = await run({ task: { routingState: recoveryState(), maxReviewRounds }, respond: (_p, o) => {
      if (o.label.startsWith('review:') && ++reviews === 1) unavailable()
      return answer(_p, o)
    } })
    assert.ifError(r.error)
    assert.equal(work(r).length, 1, 'an unavailable reviewer has not requested a code correction')
    assert.equal(reviews, maxReviewRounds)
    assert.equal(r.result.tasks[0].status, maxReviewRounds === 1 ? 'blocked' : 'review')
    assert.equal(r.result.tasks[0].routingState.qualityFailures, 2)
    assert.deepEqual(r.result.tasks[0].routingState.recoveryUnavailable, unavailableProof)
  }
})

test('unavailable review correction uses only a later existing round and keeps feedback', async () => {
  let judges = 0
  let revisions = 0
  const r = await run({ task: { maxReviewRounds: 4 }, respond: (_p, o) => {
    if (o.label.startsWith('review:')) return ++judges < 3 ? changes : approve
    if (o.label.startsWith('revise:') && ++revisions === 2) unavailable()
    return green
  } })
  assert.ifError(r.error)
  assert.deepEqual(route(r), [[normal, 'high'], [normal, 'max'], [recovery, 'max'], [normal, 'max']])
  assert.equal(r.result.tasks[0].reviewRoundsUsed, 4)
  assert.equal(r.result.tasks[0].reviewHistory.length, 2)
  assert.equal(r.result.tasks[0].routingState.qualityFailures, 2)
  assert.equal(r.result.tasks[0].status, 'review')
})

test('unavailable planner or plan judge consumes its existing round without losing the plan', async () => {
  for (const target of ['plan:', 'plan-judge:']) {
    let failed = false
    const r = await run({ task: { routingState: recoveryState(), planGate: true, maxPlanRounds: 2 }, respond: (_p, o) => {
      if (!failed && o.label.startsWith(target)) { failed = true; unavailable() }
      return answer(_p, o)
    } })
    assert.ifError(r.error)
    assert.equal(r.result.tasks[0].status, 'review')
    assert.equal(r.result.tasks[0].planRoundsUsed, 2)
    assert.equal(r.result.tasks[0].routingState.qualityFailures, 2)
    assert.deepEqual(r.result.tasks[0].routingState.recoveryUnavailable, unavailableProof)
    if (target === 'plan-judge:') assert.equal(work(r).length, 2, 'reuse the completed plan when only its judge was unavailable')
  }
})

test('runtime unavailability state cannot precede the recovery stage it attests', async () => {
  for (const qualityFailures of [0, 1]) {
    const r = await run({ task: { routingState: { version: 1, policyDigest: digest, qualityFailures,
      stage: qualityFailures ? 'maximum' : 'normal', recoveryUnavailable: unavailableProof } } })
    assert.ok(r.error)
    assert.equal(r.calls.length, 0)
  }
})
