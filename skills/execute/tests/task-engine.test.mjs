// p12-5 (ADR 0030): the engine converges exactly ONE task per Workflow call.
//
// task.workflow.js takes one `args.task` and returns an envelope with exactly one row,
// { rolloutSlug, tasks: [row] }, the shape reconcile-rollout.py reads. The lead holds the calls and runs
// the queue (execute § 4.5). These tests run the WHOLE script through tests/lib/engine.mjs runTask(), the way the
// runtime does, with a scripted `agent` stub; the prompt builders and the three convergence layers keep
// their own suites (prompt-invariants, pinned-tree, default-branch, git-env-scrub).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { runTask, loadEngine, enginePath } from '../../../tests/lib/engine.mjs'

const ROW_KEYS = [
  'slug', 'scope', 'status', 'prUrl', 'branch', 'worktreePath', 'reviewRoundsUsed', 'planRoundsUsed',
  'blockerDiagnosis', 'reviewFeedback', 'reviewHistory', 'approvedAtCeiling', 'gatedInputs', 'summary',
  'startRung', 'rung', 'climbs', 'rungDrift', 'ran',
]
const THREW = 'workflow stage threw — see /workflows'
const PLAN_TEXT = 'Planned on: abc\n### Files to modify\n- x\n### Gated inputs\nNone'

const mkTask = (slug, over = {}) => ({
  slug, taskPath: `/vault/Tasks/${slug}.md`, scope: 'cross-cutting', planGate: false,
  maxIterations: 3, maxReviewRounds: 3, maxPlanRounds: 3, rung: 'opus-xhigh', ...over,
})
const mkArgs = (task, over = {}) => ({
  rolloutSlug: 'proj-rollout-2026-10-01', repoPath: '/repo', verifier: 'make test', date: '2026-10-01',
  task, ...over,
})
const slugOf = (label) => label.split(':')[1].split(/[ @]/)[0]

// The agent stub dispatches on the label's kind and covers EVERY label the engine issues. Any other
// label is recorded in `unknown` AND throws; each case asserts `unknown` is empty, so a missed label
// fails loudly even though the engine folds a stage throw into a blocked row.
// script: { planJudge(label), review(label) → 'approve' | 'changes'; throwOn: kind to throw on }
function stub(script = {}) {
  const unknown = []
  const impl = async (prompt, opts) => {
    const label = (opts && opts.label) || ''
    const kind = label.split(':')[0]
    if (script.throwOn && kind === script.throwOn) throw new Error('scripted stage failure on ' + label)
    switch (kind) {
      case 'plan':
      case 'plan-revise':
        return { ready: true, blocked: false, blockerCause: '', plan: PLAN_TEXT }
      case 'plan-judge':
      case 'review': {
        const fn = kind === 'review' ? script.review : script.planJudge
        const verdict = fn ? fn(label) : 'approve'
        return { verdict, feedback: verdict === 'changes' ? [`fix ${label}`] : [] }
      }
      case 'implement':
      case 'investigate':
      case 'revise': {
        const s = slugOf(label)
        return {
          verified: true, blocked: false, escalate: false,
          prUrl: kind === 'investigate' ? '' : `https://github.com/o/r/pull/${s}`,
          branch: kind === 'investigate' ? '' : `audit-fix/${s}`,
          worktreePath: `/repo/.claude/worktrees/${s}`, blockerDiagnosis: '', summary: `${label} done`,
        }
      }
      default:
        unknown.push(label)
        throw new Error('stub: unknown agent label ' + label)
    }
  }
  return { impl, unknown }
}

async function run(args, script) {
  const s = stub(script)
  const out = await runTask(args, s.impl)
  return { ...out, unknown: s.unknown, labels: out.calls.map((c) => c.label) }
}

test('one code-writing task: one row with exactly the 19 result fields (args stringified or object)', async () => {
  const task = mkTask('proj-fix-a')
  const r = await run(JSON.stringify(mkArgs(task)))
  assert.equal(r.error, undefined)
  assert.deepEqual(r.unknown, [])
  assert.equal(r.result.rolloutSlug, 'proj-rollout-2026-10-01')
  assert.equal(r.result.tasks.length, 1)
  const row = r.result.tasks[0]
  assert.deepEqual(Object.keys(row).sort(), [...ROW_KEYS].sort())
  assert.equal(row.slug, 'proj-fix-a')
  assert.equal(row.status, 'review')
  assert.equal(row.reviewRoundsUsed, 1)
  assert.equal(row.prUrl, 'https://github.com/o/r/pull/proj-fix-a')
  assert.deepEqual(r.labels, ['implement:proj-fix-a', 'review:proj-fix-a r1'])
  const asObject = await run(mkArgs(task))
  assert.deepEqual(asObject.unknown, [])
  assert.deepEqual(asObject.result, r.result)
})

test('two tasks\' args give independent one-row results', async () => {
  // Isolation comes from per-call evaluation: each runTask builds a fresh context, mirroring the
  // runtime evaluating the script once per Workflow call. No cross-context claim is made here.
  const A = mkTask('proj-fix-a')
  const B = mkTask('proj-fix-b', { maxReviewRounds: 2 })
  const a1 = await run(mkArgs(A))
  const b = await run(mkArgs(B), { review: () => 'changes' })
  const a2 = await run(mkArgs(A))
  for (const r of [a1, b, a2]) { assert.equal(r.error, undefined); assert.deepEqual(r.unknown, []) }

  assert.equal(a1.result.tasks.length, 1)
  assert.equal(a1.result.tasks[0].slug, 'proj-fix-a')
  assert.equal(a1.result.tasks[0].status, 'review')
  assert.ok(a1.labels.every((l) => !l.includes('proj-fix-b')))

  assert.equal(b.result.tasks.length, 1)
  const rb = b.result.tasks[0]
  assert.equal(rb.slug, 'proj-fix-b')
  assert.equal(rb.status, 'review-blocked')
  assert.equal(rb.reviewRoundsUsed, 2)
  assert.equal(rb.reviewHistory.length, 2)
  assert.deepEqual(b.labels, ['implement:proj-fix-b', 'review:proj-fix-b r1', 'revise:proj-fix-b r2', 'review:proj-fix-b r2'])
  assert.ok(b.labels.every((l) => !l.includes('proj-fix-a')))

  assert.deepEqual(a2.result, a1.result)
  assert.deepEqual(a2.calls, a1.calls)
  assert.deepEqual(a2.logs, a1.logs)
})

test('the pre-p12-5 `waves` shape and a malformed task are refused before any dispatch', async () => {
  const task = mkTask('proj-fix-a')
  const old = await run({ rolloutSlug: 'r', repoPath: '/repo', concurrency: 4, waves: [{ wave: 1, tasks: [task] }] })
  assert.match(String(old.error && old.error.message), /args\.task, not args\.waves/)
  assert.equal(old.calls.length, 0)
  const both = await run(mkArgs(task, { waves: [{ wave: 1, tasks: [task] }] }))
  assert.match(String(both.error && both.error.message), /not args\.waves/)
  assert.equal(both.calls.length, 0)
  for (const bad of [undefined, [], null, 'proj-fix-a']) {
    const r = await run(mkArgs(bad))
    assert.match(String(r.error && r.error.message), /args\.task must be one task object/, JSON.stringify(bad))
    assert.equal(r.calls.length, 0)
    assert.deepEqual(r.unknown, [])
  }
})

test('resume determinism: the same args give the same agent calls, built by the unchanged builders', async () => {
  const task = mkTask('proj-fix-a', { rung: 'opus-high' })
  const args = mkArgs(task)
  const r1 = await run(JSON.stringify(args))
  const r2 = await run(JSON.stringify(args))
  assert.deepEqual(r1.unknown, [])
  assert.deepEqual(r1.calls.map((c) => [c.label, c.prompt]), r2.calls.map((c) => [c.label, c.prompt]))
  assert.deepEqual(r1.result, r2.result, 'the row, its rung record and ran included, is the same')
  const T = loadEngine(['implementerPrompt', 'rungState'])
  const st = T.rungState(task, args)
  const first = r1.calls.find((c) => c.label.startsWith('implement:'))
  assert.equal(first.prompt, T.implementerPrompt(task, args, st, ''))
  assert.ok(first.prompt.includes('EXACTLY ONCE'), 'a bottom-rung first pass: the one-shot')
})

test('plan-gated bottom task: the plan revise climbs, then implement and review on the reached rung', async () => {
  const task = mkTask('proj-fix-p', { rung: 'opus-high', planGate: true })
  const r = await run(mkArgs(task), { planJudge: (l) => (l.endsWith(' r1') ? 'changes' : 'approve') })
  assert.equal(r.error, undefined)
  assert.deepEqual(r.unknown, [])
  assert.deepEqual(r.labels, [
    'plan:proj-fix-p', 'plan-judge:proj-fix-p r1', 'plan-revise:proj-fix-p r2', 'plan-judge:proj-fix-p r2',
    'implement:proj-fix-p', 'review:proj-fix-p r1',
  ])
  const row = r.result.tasks[0]
  assert.equal(row.status, 'review')
  assert.equal(row.planRoundsUsed, 2)
  assert.deepEqual([row.startRung, row.rung, row.rungDrift], ['opus-high', 'opus-xhigh', ''])
  assert.deepEqual(row.climbs, [{ stage: 'plan', from: 'opus-high', to: 'opus-xhigh' }])
  assert.deepEqual(row.ran.map((x) => [x.label, x.rung]), [
    ['plan:proj-fix-p', 'opus-high'], ['plan-judge:proj-fix-p r1', 'opus-high'], ['plan-revise:proj-fix-p r2', 'opus-xhigh'],
    ['plan-judge:proj-fix-p r2', 'opus-xhigh'], ['implement:proj-fix-p', 'opus-xhigh'], ['review:proj-fix-p r1', 'opus-xhigh'],
  ])
})

test('read-only task: only the investigator runs, no review layer', async () => {
  const r = await run(mkArgs(mkTask('proj-audit-x', { scope: 'read-only' })))
  assert.equal(r.error, undefined)
  assert.deepEqual(r.unknown, [])
  assert.deepEqual(r.labels, ['investigate:proj-audit-x'])
  const row = r.result.tasks[0]
  assert.equal(row.status, 'review')
  assert.equal(row.reviewRoundsUsed, 0)
})

test('a stage that throws drops the task to a blocked row and the result still returns', async () => {
  const r = await run(mkArgs(mkTask('proj-fix-a')), { throwOn: 'implement' })
  assert.equal(r.error, undefined)
  assert.deepEqual(r.unknown, [])
  assert.equal(r.result.tasks.length, 1)
  const row = r.result.tasks[0]
  assert.equal(row.slug, 'proj-fix-a')
  assert.equal(row.status, 'blocked')
  assert.equal(row.blockerDiagnosis, THREW)
  assert.deepEqual([row.startRung, row.rung, row.climbs], ['opus-xhigh', 'opus-xhigh', []])
  assert.deepEqual(row.ran.map((x) => x.label), ['implement:proj-fix-a'], 'what ran before the throw')
  assert.ok(r.logs.some((l) => l.includes('converge threw on proj-fix-a')), r.logs.join('\n'))
})

test('progress is relayed verbatim once and is the only log line starting progress:', async () => {
  const progress = 'progress: 2/6 merged, 1 running, 3 queued — 42m elapsed, ~50m remaining (rough)'
  const withP = await run(mkArgs(mkTask('proj-fix-a'), { progress }))
  assert.deepEqual(withP.unknown, [])
  assert.equal(withP.logs.filter((l) => l === progress).length, 1)
  assert.deepEqual(withP.logs.filter((l) => l.startsWith('progress:')), [progress])
  const without = await run(mkArgs(mkTask('proj-fix-a')))
  assert.deepEqual(without.logs.filter((l) => l.startsWith('progress:')), [])
  assert.ok(without.logs.some((l) => l.startsWith('task: proj-rollout-2026-10-01 — proj-fix-a (cross-cutting)')))
})

test('an unusable defaultBranch fails the call before any dispatch', async () => {
  const r = await run(mkArgs(mkTask('proj-fix-a'), { defaultBranch: '-x' }))
  assert.match(String(r.error && r.error.message), /defaultBranch: refusing/)
  assert.equal(r.calls.length, 0)
})

test('an invalid review budget fails closed per task with no dispatch', async () => {
  const r = await run(mkArgs(mkTask('proj-fix-a', { maxReviewRounds: 0 })))
  assert.equal(r.error, undefined)
  assert.equal(r.calls.length, 0)
  const row = r.result.tasks[0]
  assert.equal(row.status, 'review-blocked')
  assert.match(row.blockerDiagnosis, /max_review_rounds = 0/)
})

test('static: the engine is task-shaped (the retired script is queue-only.test.mjs (d))', () => {
  const src = fs.readFileSync(enginePath, 'utf8')
  // The only a.waves read is the refusal guard.
  assert.deepEqual(src.match(/\ba\.waves\b[^\n]*/g), ["a.waves !== undefined) throw new Error('task.workflow.js takes one args.task, not args.waves (ADR 0030, p12-5)')"])
  assert.ok(!/concurrency/.test(src), 'no concurrency')
  assert.ok(!/\bchunk\(/.test(src), 'no chunk(')
  assert.ok(!/\bpipeline\(/.test(src), 'no pipeline(')
  assert.match(src, /name: 'task',/)
})
