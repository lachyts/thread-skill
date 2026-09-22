// Run the actual workflow with only the external agent boundary replaced.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

const source = fs.readFileSync(new URL('../wave-execute.workflow.js', import.meta.url), 'utf8')
  .replace('export const meta', 'const meta')
const task = { slug: 'project-task', taskPath: '/adopted/task.md', scope: 'cross-cutting',
  planGate: true, maxIterations: 3, maxPlanRounds: 2, maxReviewRounds: 2 }
const green = { verified: true, blocked: false, escalate: false,
  prUrl: 'https://github.com/owner/repo/pull/1', branch: 'audit-fix/task',
  worktreePath: '/worktree', blockerDiagnosis: '', summary: 'verified' }
const plan = { ready: true, blocked: false, blockerCause: '', plan: '### Gated inputs\nNone' }
const approve = { verdict: 'approve', feedback: [] }
const changes = { verdict: 'changes', feedback: ['Correct the implementation'] }
const verifiedHead = 'b'.repeat(40)
const v4 = { protocolVersion: 4, baseBranch: 'trunk', baseRef: 'a'.repeat(40), authorisation: 'Adopted scope only.' }
const verified = { ...green, verifiedHead }
const reviewed = { ...approve, reviewedHead: verifiedHead }

async function run(overrides = {}, agentResult = (_p, o) => o.schema.properties.ready ? plan
  : o.schema.properties.verdict ? approve : green) {
  const calls = []
  const config = { rolloutSlug: 'rollout', repoPath: '/repo', verifier: 'make test',
    concurrency: 2, waves: [{ wave: 1, tasks: [{ ...task }] }], ...overrides }
  const ctx = { args: config, log() {},
    pipeline: async (items, fn) => Promise.all(items.map(fn)),
    agent: async (prompt, opts) => { calls.push({ prompt, ...opts }); return agentResult(prompt, opts) } }
  vm.createContext(ctx)
  try {
    return { result: await vm.runInContext(`(async () => {${source}\n})()`, ctx), calls }
  } catch (error) { return { error, calls } }
}
const oneTask = (fields) => ({ waves: [{ wave: 1, tasks: [{ ...task, ...fields }] }] })

test('invalid stage budgets reject the entire input before any agent dispatch', async () => {
  for (const field of ['maxIterations', 'maxPlanRounds', 'maxReviewRounds']) {
    for (const value of [0, -1, '2', 'invalid', 1.5, null, undefined, true, NaN, Infinity]) {
      const result = await run({ waves: [{ wave: 1, tasks: [{ ...task }, { ...task, slug: 'bad-task', [field]: value }] }] })
      assert.ok(result.error, `${field}=${String(value)} must be rejected`)
      assert.match(result.error.message, new RegExp(field))
      assert.equal(result.calls.length, 0, 'a later invalid task must not leave earlier tasks in flight')
    }
  }
})

test('invalid concurrency cannot silently omit the entire wave', async () => {
  for (const concurrency of [0, -1, '4', 'invalid', 1.5, null, true, NaN, Infinity]) {
    const result = await run({ concurrency })
    assert.ok(result.error, `concurrency=${String(concurrency)} must be rejected`)
    assert.match(result.error.message, /concurrency/)
    assert.equal(result.calls.length, 0)
  }
  const valid = await run({ concurrency: undefined })
  assert.equal(valid.result.tasks.length, 1, 'omitted concurrency retains its v3 default')
})

test('an explicit protocol version cannot silently fall back to legacy authority rules', async () => {
  for (const protocolVersion of ['4', null, 0, 5]) {
    const result = await run({ protocolVersion })
    assert.ok(result.error, String(protocolVersion))
    assert.equal(result.calls.length, 0)
  }
})

test('unverified implementation with an existing PR never becomes merge eligible', async () => {
  const result = await run(oneTask({ planGate: false, model: 'fable' }), (_p, o) =>
    o.schema.properties.verdict ? approve : { ...green, verified: false })
  assert.equal(result.result.tasks[0].status, 'blocked')
  assert.equal(result.result.tasks[0].prUrl, green.prUrl)
  assert.equal(result.calls.filter(c => c.label.startsWith('review:')).length, 0)
})

test('unverified investigation cannot be recorded as successfully reviewed', async () => {
  const result = await run(oneTask({ scope: 'read-only', planGate: false }), () =>
    ({ ...green, verified: false, prUrl: '', branch: '', worktreePath: '' }))
  assert.equal(result.result.tasks[0].status, 'blocked')
})

test('investigator-discovered gates pause before escalation or a transient retry can lose them', async () => {
  for (const config of [{}, v4]) {
    let calls = 0
    const result = await run({ ...config, ...oneTask({ scope: 'read-only', planGate: false }) }, () => {
      calls++
      return calls === 1 ? { ...green, verified: false, blocked: true, verifiedHead: '', prUrl: '',
        gatedInputs: ['credential: RESEARCH_KEY'], blockerDiagnosis: 'Needs credential approval' } : null
    })
    assert.equal(result.result.tasks[0].status, 'gate-pending')
    assert.deepEqual(Array.from(result.result.tasks[0].gatedInputs), ['credential: RESEARCH_KEY'])
    assert.equal(result.calls.length, 1, 'a human gate must spend no escalation or retry budget')
    assert.equal(result.result.tasks[0].escalated, false)
  }
})

test('unverified revision cannot reach a second review approval', async () => {
  const result = await run(oneTask({ planGate: false, model: 'fable' }), (_p, o) => {
    if (o.label.startsWith('review:')) return o.label.endsWith('r1') ? changes : approve
    return o.label.startsWith('revise:') ? { ...green, verified: false } : green
  })
  assert.equal(result.result.tasks[0].status, 'blocked')
  assert.equal(result.calls.filter(c => c.label.startsWith('review:')).length, 1)
})

test('a revision gate pauses even when the agent forgot blocked=true', async () => {
  const result = await run(oneTask({ planGate: false, model: 'fable' }), (_p, o) => {
    if (o.label.startsWith('review:')) return changes
    return o.label.startsWith('revise:') ? { ...green, gatedInputs: ['spend: API cap USD 5'] } : green
  })
  assert.equal(result.result.tasks[0].status, 'gate-pending')
  assert.equal(result.calls.filter(c => c.label.startsWith('review:')).length, 1)
})

for (const layer of ['plan', 'review']) {
  test(`last ${layer} rejection records the next tier without an extra attempt`, async () => {
    const result = await run(oneTask({ planGate: layer === 'plan', maxPlanRounds: 1, maxReviewRounds: 1 }), (_p, o) =>
      o.schema.properties.ready ? plan : o.schema.properties.verdict ? changes : green)
    const outcome = result.result.tasks[0]
    assert.equal(outcome.status, `${layer}-blocked`)
    assert.equal(outcome.model, 'opus')
    assert.equal(outcome.escalated, false, 'the stronger tier was never dispatched')
    assert.equal(outcome.nextModel, 'fable')
    assert.equal(outcome.nextModelReason, layer)
    assert.equal(result.calls.filter(c => c.model === 'fable').length, 0)
    assert.equal(result.calls.filter(c => c.label.startsWith(`${layer === 'plan' ? 'plan-judge' : 'review'}:`)).length, 1)
  })
}

test('a capped final rejection records suppression without spending another round', async () => {
  const result = await run({ ...oneTask({ planGate: false, maxReviewRounds: 1 }), maxTier: 'opus' }, (_p, o) =>
    o.schema.properties.verdict ? changes : green)
  assert.equal(result.result.tasks[0].tierCapped, true)
  assert.equal(result.result.tasks[0].model, 'opus')
  assert.equal(result.result.tasks[0].escalated, false)
  assert.equal(result.calls.length, 2)
})

test('explicit base configuration requires a branch and immutable commit together', async () => {
  for (const fields of [{ baseBranch: 'trunk' }, { baseRef: 'a'.repeat(40) },
    { baseBranch: 'trunk', baseRef: 'origin/trunk' }]) {
    const result = await run(fields)
    assert.ok(result.error, JSON.stringify(fields))
    assert.equal(result.calls.length, 0)
  }
})

test('planning and implementation use the adopted commit even when remote and root move', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thread-engine-base-'))
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  try {
    const origin = path.join(dir, 'origin'); fs.mkdirSync(origin)
    git(origin, 'init', '--initial-branch=trunk')
    git(origin, 'config', 'user.email', 'test@example.invalid'); git(origin, 'config', 'user.name', 'Test')
    fs.writeFileSync(path.join(origin, 'source.txt'), 'adopted\n')
    git(origin, 'add', '.'); git(origin, 'commit', '-m', 'adopted')
    const baseRef = git(origin, 'rev-parse', 'HEAD')
    const repo = path.join(dir, 'repo with spaces')
    execFileSync('git', ['clone', origin, repo], { stdio: 'pipe' })
    fs.writeFileSync(path.join(origin, 'source.txt'), 'new remote tip\n')
    git(origin, 'add', '.'); git(origin, 'commit', '-m', 'advance remote')
    git(repo, 'fetch', 'origin'); git(repo, 'checkout', '--detach', 'origin/trunk')
    const heads = []
    const result = await run({ repoPath: repo, baseBranch: 'trunk', baseRef }, (prompt, opts) => {
      if (opts.label.startsWith('plan:') || opts.label.startsWith('implement:')) {
        const setup = prompt.match(/```bash\n([\s\S]*?)```/)
        assert.ok(setup, `${opts.label} must provide executable snapshot setup`)
        heads.push(execFileSync('bash', ['-c', setup[1] + '\ngit rev-parse HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n').at(-1))
      }
      return opts.schema.properties.ready ? plan : opts.schema.properties.verdict ? approve : green
    })
    assert.ifError(result.error)
    assert.deepEqual(heads, [baseRef, baseRef])
    assert.equal(result.result.tasks[0].status, 'review')
    const planningRoot = path.join(repo, '.claude/worktrees/project-task-base-' + baseRef)
    for (const call of result.calls.filter(c => c.phase === 'Plan-gate')) assert.ok(call.prompt.includes(planningRoot))
    assert.ok(result.calls.find(c => c.label.startsWith('implement:')).prompt.includes('--base'))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('v4 rejects release-gate overrides and keeps durable approved gates authoritative', async () => {
  const binding = v4
  const invalid = await run({ ...binding, ...oneTask({ ignoreGate: true }) })
  assert.ok(invalid.error)
  assert.match(invalid.error.message, /ignoreGate/)
  assert.equal(invalid.calls.length, 0)
  const authorisation = 'Implement the adopted scope; return significant decisions in summary for independent review.'
  const result = await run({ ...binding, authorisation,
    ...oneTask({ approvedGates: ['credential: READ_ONLY_KEY'] }) }, (_p, o) =>
    o.schema.properties.ready ? plan : o.schema.properties.reviewedHead ? reviewed : o.schema.properties.verdict ? approve : verified)
  assert.ifError(result.error)
  for (const call of result.calls) {
    assert.ok(call.prompt.includes(authorisation), call.label)
    assert.ok(call.prompt.includes('immutable adopted task'), call.label)
    assert.ok(!call.prompt.includes('append that diagnosis to the task note'), call.label)
  }
  const implementation = result.calls.find(c => c.label.startsWith('implement:')).prompt
  assert.ok(implementation.includes('credential: READ_ONLY_KEY'))
  assert.ok(implementation.includes('sole approval record'))
  assert.ok(!implementation.includes('note\'s "## Approved gates" section covers ALL'))
})

test('v4 retries and judges keep immutable requirements and schema-compatible gate instructions', async () => {
  const result = await run({ protocolVersion: 4, baseBranch: 'trunk', baseRef: 'a'.repeat(40),
    authorisation: 'Adopted changes only.', ...oneTask({ model: 'fable' }) }, (_p, opts) => {
    if (opts.schema.properties.ready) return plan
    if (opts.schema.properties.reviewedHead) return opts.label.endsWith('r1') ? { ...changes, reviewedHead: verifiedHead } : reviewed
    if (opts.schema.properties.verdict) return opts.label.endsWith('r1') ? changes : approve
    return verified
  })
  assert.equal(result.result.tasks[0].status, 'review')
  for (const call of result.calls) {
    assert.ok(call.prompt.includes(task.taskPath), `${call.label} must retain the adopted requirements path`)
    if (call.schema.properties.gatedInputs) {
      assert.ok(!call.schema.properties.gatedInputs.description.includes('note\'s "## Approved gates"'), call.label)
    } else {
      assert.ok(!call.prompt.includes('return blocked=true with the missing gates in gatedInputs'), `${call.label} must follow its own result schema`)
    }
  }
})

test('v4 cannot approve verification evidence that lacks a concrete commit', async () => {
  for (const head of [undefined, '', 'main', 'short', 'g'.repeat(40)]) {
    const result = await run({ ...v4, ...oneTask({ planGate: false, model: 'fable' }) }, (_p, o) =>
      o.schema.properties.verdict ? reviewed : { ...verified, verifiedHead: head })
    assert.equal(result.result.tasks[0].status, 'blocked', String(head))
    assert.equal(result.calls.filter(c => c.label.startsWith('review:')).length, 0)
  }
})

test('v4 rejects approval of a different or absent PR head within the existing round allowance', async () => {
  for (const reviewedHead of [undefined, '', 'c'.repeat(40)]) {
    const result = await run({ ...v4, ...oneTask({ planGate: false, maxReviewRounds: 1 }) }, (_p, o) =>
      o.schema.properties.verdict ? { ...approve, reviewedHead } : verified)
    const outcome = result.result.tasks[0]
    assert.equal(outcome.status, 'review-blocked')
    assert.match(outcome.blockerDiagnosis, /head|commit/i)
    assert.equal(outcome.verifiedHead, verifiedHead)
    assert.equal(result.calls.length, 2, 'stale evidence cannot grant an unbudgeted re-review')
  }
})

test('v4 returns the exact matching verification and review commits', async () => {
  const result = await run({ ...v4, ...oneTask({ planGate: false }) }, (_p, o) =>
    o.schema.properties.verdict ? reviewed : verified)
  const outcome = result.result.tasks[0]
  assert.equal(outcome.status, 'review')
  assert.equal(outcome.verifiedHead, verifiedHead)
  assert.equal(outcome.reviewedHead, verifiedHead)
  const implementation = result.calls.find(c => c.label.startsWith('implement:'))
  const review = result.calls.find(c => c.label.startsWith('review:'))
  assert.ok(implementation.schema.required.includes('verifiedHead'))
  assert.ok(review.schema.required.includes('reviewedHead'))
  assert.ok(implementation.prompt.includes('git rev-parse HEAD'))
  assert.ok(review.prompt.includes(verifiedHead))
  assert.ok(review.prompt.includes('headRefOid'))
})

test('v4 revisers must refresh their verification commit before another approval', async () => {
  const result = await run({ ...v4, ...oneTask({ planGate: false, model: 'fable' }) }, (_p, o) => {
    if (o.label.startsWith('review:')) return o.label.endsWith('r1') ? { ...changes, reviewedHead: verifiedHead } : reviewed
    return o.label.startsWith('revise:') ? green : verified
  })
  assert.equal(result.result.tasks[0].status, 'blocked')
  assert.equal(result.calls.filter(c => c.label.startsWith('review:')).length, 1)
})
