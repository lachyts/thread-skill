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
import { runTask, loadEngine, enginePath, VERIFY_SLOT } from '../../../tests/lib/engine.mjs'

const ROW_KEYS = [
  'slug', 'scope', 'status', 'prUrl', 'branch', 'worktreePath', 'reviewRoundsUsed', 'planRoundsUsed',
  'blockerDiagnosis', 'reviewFeedback', 'reviewHistory', 'approvedAtCeiling', 'gatedInputs', 'summary',
  'startRung', 'rung', 'climbs', 'rungDrift', 'ran', 'plan', 'needsHuman', 'reviewVerdicts',
]
const THREW = 'workflow stage threw — see /workflows'
const PLAN_TEXT = 'Planned on: abc\n### Files to modify\n- x\n### Gated inputs\nNone'

const mkTask = (slug, over = {}) => ({
  slug, taskPath: `/vault/Tasks/${slug}.md`, scope: 'cross-cutting', planGate: false,
  maxIterations: 3, maxReviewRounds: 3, maxPlanRounds: 3, rung: 'opus-xhigh', ...over,
})
const mkArgs = (task, over = {}) => ({
  rolloutSlug: 'proj-rollout-2026-10-01', repoPath: '/repo', verifier: 'make test', date: '2026-10-01',
  verifySlot: VERIFY_SLOT, task, ...over,
})
const slugOf = (label) => label.split(':')[1].split(/[ @]/)[0]

// The agent stub dispatches on the label's kind and covers EVERY label the engine issues. Any other
// label is recorded in `unknown` AND throws; each case asserts `unknown` is empty, so a missed label
// fails loudly even though the engine folds a stage throw into a blocked row.
// script: { planJudge(label), review(label) → 'approve' | 'changes'; throwOn: kind to throw on;
//   plan: the planner's plan text (default PLAN_TEXT); implGates: gates the implementer stops on;
//   reviseBlocked: the reviser stops blocked; reviseGates: gates the reviser stops on; ask(label) → a
//   needsHuman value a judge returns (absent ⇒ the key is left out); feedback(label) → a review judge's
//   bullets (default one `fix <label>` on changes); head(label) → the head a review judge returns (absent ⇒
//   the key is left out); dead(label) → true makes the agent return null on both runAgent attempts;
//   result(label) → fields merged over an implement / investigate / revise result; bounce(label) → the gateBounce
//   a plan judge returns (absent ⇒ the key is left out, ADR 0038); revisedPlan: the plan reviser's text, a string
//   or (label) → string (default the planner's) }
// Every dispatch's opts are recorded, in order, as { label, opts } (run()'s `opts`).
function stub(script = {}) {
  const unknown = []
  const seen = []
  const impl = async (prompt, opts) => {
    const label = (opts && opts.label) || ''
    seen.push({ label, opts })
    const kind = label.split(':')[0]
    if (script.throwOn && kind === script.throwOn) throw new Error('scripted stage failure on ' + label)
    if (script.dead && script.dead(label)) return null
    switch (kind) {
      case 'plan':
      case 'plan-revise': {
        const rp = script.revisedPlan
        const text = kind === 'plan-revise' && rp !== undefined ? (typeof rp === 'function' ? rp(label) : rp) : script.plan || PLAN_TEXT
        return { ready: true, blocked: false, blockerCause: '', plan: text }
      }
      case 'plan-judge':
      case 'review': {
        const fn = kind === 'review' ? script.review : script.planJudge
        const verdict = fn ? fn(label) : 'approve'
        const q = script.ask ? script.ask(label) : undefined
        const fb = kind === 'review' && script.feedback ? script.feedback(label) : undefined
        const h = kind === 'review' && script.head ? script.head(label) : undefined
        const b = kind === 'plan-judge' && script.bounce ? script.bounce(label) : undefined
        return {
          verdict, feedback: fb !== undefined ? fb : verdict === 'changes' ? [`fix ${label}`] : [],
          ...(q === undefined ? {} : { needsHuman: q }), ...(h === undefined ? {} : { head: h }),
          ...(b === undefined ? {} : { gateBounce: b }),
        }
      }
      case 'implement':
      case 'investigate':
      case 'revise': {
        const s = slugOf(label)
        if (kind === 'implement' && script.implGates) {
          return { verified: false, blocked: true, escalate: false, prUrl: '', branch: '', worktreePath: '', blockerDiagnosis: 'needs a gate', summary: '', gatedInputs: script.implGates }
        }
        if (kind === 'revise' && script.reviseGates) {
          return { verified: false, blocked: true, escalate: false, prUrl: '', branch: '', worktreePath: '', blockerDiagnosis: 'needs a gate', summary: '', gatedInputs: script.reviseGates }
        }
        if (kind === 'revise' && script.reviseBlocked) {
          return { verified: false, blocked: true, escalate: false, prUrl: '', branch: '', worktreePath: '', blockerDiagnosis: 'reviser could not resolve it', summary: '' }
        }
        return {
          verified: true, blocked: false, escalate: false,
          prUrl: kind === 'investigate' ? '' : `https://github.com/o/r/pull/${s}`,
          branch: kind === 'investigate' ? '' : `audit-fix/${s}`,
          worktreePath: `/repo/.claude/worktrees/${s}`, blockerDiagnosis: '', summary: `${label} done`,
          ...(script.result ? script.result(label) : {}),
        }
      }
      default:
        unknown.push(label)
        throw new Error('stub: unknown agent label ' + label)
    }
  }
  return { impl, unknown, seen }
}

async function run(args, script) {
  const s = stub(script)
  const out = await runTask(args, s.impl)
  return { ...out, unknown: s.unknown, labels: out.calls.map((c) => c.label), opts: s.seen }
}

test('one code-writing task: one row with exactly the 22 result fields (args stringified or object)', async () => {
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

// ---- p14-2: the row's `plan` (L2). Three states, settled only by the task's own call: the approved plan
// (a string) when the own call ran with one, '' when the own call ran without a plan-gate, null when the
// call reached no plan outcome (plan-blocked, a planLoop gate-pending, the pre-flight block, a throw, and
// every seeded-revise row). reconcile upserts / removes / leaves the note's "## Approved plan" by it.

// Written FIRST (before converge changed): the resume row must be the awaited reviewLoop result, so a
// stray `{ ...reviewLoop(...) }` (a spread Promise) cannot satisfy these.
test('p14-2: a seeded revise row carries plan null and the real reviewLoop result', async () => {
  const T = loadEngine(['shortAlias', 'worktreeDir'])
  const slug = 'proj-fix-a'
  const R = {
    stage: 'revise', prUrl: 'https://github.com/o/r/pull/7', branch: `audit-fix/${T.shortAlias(slug)}`,
    worktreePath: T.worktreeDir('/repo', slug), reviewHistory: [{ round: 1, feedback: ['keep their rename'], stage: 'integration' }],
    reviewRoundsUsed: 1, plan: PLAN_TEXT,
  }
  const ok = await run(mkArgs(mkTask(slug, { resume: R })))
  assert.equal(ok.error, undefined)
  assert.deepEqual(ok.unknown, [])
  const okRow = ok.result.tasks[0]
  assert.deepEqual(Object.keys(okRow).sort(), [...ROW_KEYS].sort())
  assert.equal(okRow.status, 'review')
  assert.equal(okRow.reviewRoundsUsed, R.reviewRoundsUsed + 1, 'the seeded revise and its judge ran')
  assert.equal(okRow.plan, null)
  const stopped = await run(mkArgs(mkTask(slug, { resume: R })), { reviseBlocked: true })
  assert.equal(stopped.error, undefined)
  assert.deepEqual(stopped.unknown, [])
  const sRow = stopped.result.tasks[0]
  assert.equal(sRow.status, 'blocked')
  assert.match(sRow.blockerDiagnosis, /\nrevise stopped: reviser could not resolve it/)
  assert.equal(sRow.plan, null)
})

test('p14-2: a plan-gated own call returns its approved plan; a non-gated one returns ""', async () => {
  const gated = await run(mkArgs(mkTask('proj-fix-p', { planGate: true })))
  assert.deepEqual(gated.unknown, [])
  assert.equal(gated.result.tasks[0].status, 'review')
  assert.equal(gated.result.tasks[0].plan, PLAN_TEXT)
  const plain = await run(mkArgs(mkTask('proj-fix-a')))
  assert.equal(plain.result.tasks[0].status, 'review')
  assert.equal(plain.result.tasks[0].plan, '')
  const ro = await run(mkArgs(mkTask('proj-audit-x', { scope: 'read-only' })))
  assert.equal(ro.result.tasks[0].plan, '')
})

test('p14-2: an implementer gate-pending row carries the plan it ran on ("" when not plan-gated)', async () => {
  const gates = ['spend: an API — cap $5']
  const gated = await run(mkArgs(mkTask('proj-fix-p', { planGate: true })), { implGates: gates })
  assert.deepEqual(gated.unknown, [])
  assert.equal(gated.result.tasks[0].status, 'gate-pending')
  assert.equal(gated.result.tasks[0].plan, PLAN_TEXT)
  const plain = await run(mkArgs(mkTask('proj-fix-a')), { implGates: gates })
  assert.equal(plain.result.tasks[0].status, 'gate-pending')
  assert.equal(plain.result.tasks[0].plan, '')
})

test('p14-2: no plan outcome gives plan null (plan-blocked, planLoop gate-pending, pre-flight, threw)', async () => {
  const blocked = await run(mkArgs(mkTask('proj-fix-p', { planGate: true, maxPlanRounds: 1 })), { planJudge: () => 'changes' })
  assert.deepEqual(blocked.unknown, [])
  assert.equal(blocked.result.tasks[0].status, 'plan-blocked')
  assert.equal(blocked.result.tasks[0].plan, null)
  const gatedPlan = 'Planned on: abc\n### Files to modify\n- x\n### Gated inputs\n- spend: an API — cap $5'
  const pending = await run(mkArgs(mkTask('proj-fix-p', { planGate: true })), { plan: gatedPlan })
  assert.deepEqual(pending.unknown, [])
  assert.equal(pending.result.tasks[0].status, 'gate-pending')
  assert.deepEqual(pending.labels, ['plan:proj-fix-p', 'plan-judge:proj-fix-p r1'])
  assert.equal(pending.result.tasks[0].plan, null)
  for (const planGate of [false, true]) {
    const pre = await run(mkArgs(mkTask('proj-fix-a', { planGate, maxReviewRounds: 0 })))
    assert.equal(pre.calls.length, 0)
    assert.equal(pre.result.tasks[0].status, 'review-blocked')
    assert.equal(pre.result.tasks[0].plan, null, `pre-flight, planGate ${planGate}`)
  }
  for (const [planGate, throwOn] of [[false, 'implement'], [true, 'implement'], [true, 'plan']]) {
    const threw = await run(mkArgs(mkTask('proj-fix-a', { planGate })), { throwOn })
    assert.equal(threw.result.tasks[0].blockerDiagnosis, THREW)
    assert.equal(threw.result.tasks[0].plan, null, `threw on ${throwOn}, planGate ${planGate}`)
  }
})

// ---- p16-3: needsHuman. A plan judge, a review judge, an implementer, an investigator or a reviser may return
// the exact question a person must answer. It is a stop that is never evidence of hardness: no climb, no
// in-call retry, no further round. The row carries it ('' when there is none; null on an integrate row).
const Q = 'Which retention window should the cache use: 7 or 30 days?'
const BLOCKED_Q = { verified: false, blocked: true, escalate: false, prUrl: '', branch: '', worktreePath: '', blockerDiagnosis: Q, summary: '', needsHuman: '  ' + Q + '  ' }

test('p16-3: a plan judge that returns needsHuman stops the plan gate', async () => {
  const task = mkTask('proj-fix-p', { rung: 'opus-high', planGate: true })
  const r = await run(mkArgs(task), { planJudge: () => 'changes', ask: (l) => (l.endsWith(' r1') ? Q : '') })
  assert.equal(r.error, undefined)
  assert.deepEqual(r.unknown, [])
  assert.deepEqual(r.labels, ['plan:proj-fix-p', 'plan-judge:proj-fix-p r1'], 'no plan-revise, no implement')
  const row = r.result.tasks[0]
  assert.deepEqual(Object.keys(row).sort(), [...ROW_KEYS].sort())
  assert.equal(row.status, 'plan-blocked')
  assert.equal(row.planRoundsUsed, 1)
  assert.deepEqual(row.climbs, [], 'a question is never evidence of hardness')
  assert.equal(row.needsHuman, Q)
  assert.ok(row.blockerDiagnosis.startsWith('needs a human decision: ' + Q), row.blockerDiagnosis)
  assert.match(row.blockerDiagnosis, /Round 1: fix plan-judge:proj-fix-p r1/)
  assert.equal(row.plan, null)
})

test('p16-3: a plan judge question on the last round is the same plan-blocked stop', async () => {
  const task = mkTask('proj-fix-p', { planGate: true, maxPlanRounds: 2 })
  const r = await run(mkArgs(task), { planJudge: () => 'changes', ask: (l) => (l.endsWith(' r2') ? Q : '') })
  assert.deepEqual(r.unknown, [])
  assert.deepEqual(r.labels, ['plan:proj-fix-p', 'plan-judge:proj-fix-p r1', 'plan-revise:proj-fix-p r2', 'plan-judge:proj-fix-p r2'])
  const row = r.result.tasks[0]
  assert.equal(row.status, 'plan-blocked')
  assert.equal(row.planRoundsUsed, 2)
  assert.equal(row.needsHuman, Q)
  assert.match(row.blockerDiagnosis, /^needs a human decision: .*\n[\s\S]*Round 1: [\s\S]*Round 2: /)
})

test('p16-3: a review judge that returns needsHuman ends review-blocked with no reviser and no climb', async () => {
  const r = await run(mkArgs(mkTask('proj-fix-a')), { review: () => 'changes', ask: (l) => (l.startsWith('review:') ? Q : undefined) })
  assert.equal(r.error, undefined)
  assert.deepEqual(r.unknown, [])
  assert.deepEqual(r.labels, ['implement:proj-fix-a', 'review:proj-fix-a r1'])
  const row = r.result.tasks[0]
  assert.equal(row.status, 'review-blocked')
  assert.equal(row.reviewRoundsUsed, 1)
  assert.deepEqual(row.reviewHistory, [{ round: 1, feedback: ['fix review:proj-fix-a r1'] }])
  assert.deepEqual(row.climbs, [])
  assert.equal(row.needsHuman, Q)
})

test('p16-3: an implementer that returns blocked with needsHuman stops at once, no climb, no retry', async () => {
  const r = await run(mkArgs(mkTask('proj-fix-a', { rung: 'opus-high' })), { result: (l) => (l.startsWith('implement:') ? BLOCKED_Q : {}) })
  assert.equal(r.error, undefined)
  assert.deepEqual(r.unknown, [])
  assert.deepEqual(r.labels, ['implement:proj-fix-a'])
  const row = r.result.tasks[0]
  assert.equal(row.status, 'blocked')
  assert.deepEqual(row.climbs, [])
  assert.equal(row.needsHuman, Q, 'trimmed')
  assert.equal(row.blockerDiagnosis, Q)
})

test('p16-3: a read-only investigator that returns blocked with needsHuman stops at once', async () => {
  const r = await run(mkArgs(mkTask('proj-audit-x', { scope: 'read-only', rung: 'opus-high' })), { result: () => BLOCKED_Q })
  assert.deepEqual(r.unknown, [])
  assert.deepEqual(r.labels, ['investigate:proj-audit-x'])
  const row = r.result.tasks[0]
  assert.equal(row.status, 'blocked')
  assert.deepEqual(row.climbs, [])
  assert.equal(row.needsHuman, Q)
})

test('p16-3: a reviser that stops blocked with needsHuman carries it to the row', async () => {
  const r = await run(mkArgs(mkTask('proj-fix-a')), { review: () => 'changes', result: (l) => (l.startsWith('revise:') ? BLOCKED_Q : {}) })
  assert.deepEqual(r.unknown, [])
  assert.deepEqual(r.labels, ['implement:proj-fix-a', 'review:proj-fix-a r1', 'revise:proj-fix-a r2'])
  const row = r.result.tasks[0]
  assert.equal(row.status, 'blocked')
  assert.equal(row.needsHuman, Q)
})

test('p16-3: a stray needsHuman (approve, verified, escalate) is ignored and never reaches the row', async () => {
  const approve = await run(mkArgs(mkTask('proj-fix-a')), { ask: () => Q })
  assert.deepEqual(approve.unknown, [])
  assert.equal(approve.result.tasks[0].status, 'review')
  assert.equal(approve.result.tasks[0].needsHuman, '')
  assert.ok(approve.logs.some((l) => /needsHuman .*ignored/.test(l)), approve.logs.join('\n'))
  const planApprove = await run(mkArgs(mkTask('proj-fix-p', { planGate: true })), { ask: (l) => (l.startsWith('plan-judge:') ? Q : undefined) })
  assert.deepEqual(planApprove.labels, ['plan:proj-fix-p', 'plan-judge:proj-fix-p r1', 'implement:proj-fix-p', 'review:proj-fix-p r1'])
  assert.equal(planApprove.result.tasks[0].needsHuman, '')
  // a verified implementer carrying a question, then review-blocked at the ceiling: the question never leaks
  const verified = await run(mkArgs(mkTask('proj-fix-a', { maxReviewRounds: 1 })), { review: () => 'changes', result: (l) => (l.startsWith('implement:') ? { needsHuman: Q } : {}) })
  assert.deepEqual(verified.unknown, [])
  assert.equal(verified.result.tasks[0].status, 'review-blocked')
  assert.equal(verified.result.tasks[0].needsHuman, '')
  // escalate=true (a one-shot red) carrying a question still climbs and retries
  const red = await run(mkArgs(mkTask('proj-fix-a', { rung: 'opus-high' })), {
    result: (l) => (l === 'implement:proj-fix-a' ? { verified: false, escalate: true, prUrl: '', needsHuman: Q } : {}),
  })
  assert.deepEqual(red.unknown, [])
  assert.deepEqual(red.labels, ['implement:proj-fix-a', 'implement:proj-fix-a@opus-xhigh', 'review:proj-fix-a r1'])
  assert.equal(red.result.tasks[0].status, 'review')
  assert.equal(red.result.tasks[0].needsHuman, '')
  // a non-string needsHuman on a blocked stop is not a question: the ordinary climb and retry run
  const odd = await run(mkArgs(mkTask('proj-fix-a', { rung: 'opus-high' })), {
    result: (l) => (l === 'implement:proj-fix-a' ? { ...BLOCKED_Q, needsHuman: 7 } : {}),
  })
  assert.deepEqual(odd.labels, ['implement:proj-fix-a', 'implement:proj-fix-a@opus-xhigh', 'review:proj-fix-a r1'])
  assert.equal(odd.result.tasks[0].needsHuman, '')
})

test('p16-3: unapproved gates win over a question (gate-pending), and the question rides along', async () => {
  const r = await run(mkArgs(mkTask('proj-fix-a')), { result: (l) => (l.startsWith('implement:') ? { ...BLOCKED_Q, gatedInputs: ['spend: an API — cap $5'] } : {}) })
  assert.deepEqual(r.unknown, [])
  assert.deepEqual(r.labels, ['implement:proj-fix-a'])
  const row = r.result.tasks[0]
  assert.equal(row.status, 'gate-pending')
  assert.deepEqual(row.gatedInputs, ['spend: an API — cap $5'])
  assert.equal(row.needsHuman, Q)
})

test('p16-3: a verified result listing unapproved gates is gate-pending, and its stray question is ignored', async () => {
  const r = await run(mkArgs(mkTask('proj-fix-a')), { result: (l) => (l.startsWith('implement:') ? { gatedInputs: ['spend: an API — cap $5'], needsHuman: Q } : {}) })
  assert.deepEqual(r.unknown, [])
  assert.deepEqual(r.labels, ['implement:proj-fix-a'])
  const row = r.result.tasks[0]
  assert.equal(row.status, 'gate-pending', 'the gates still pause it')
  assert.deepEqual(row.gatedInputs, ['spend: an API — cap $5'])
  assert.equal(row.needsHuman, '', 'a question rides on a gate stop only when the agent blocked on it')
})

test('p16-3: a first pass blocked with no question climbs; a retry that blocks on one ends blocked with it', async () => {
  // The climbed retry needs no question check of its own: the fall-through keeps a blocked result's question
  // and the plan metadata, which this pins (planGate on, so planRoundsUsed rides on the row too).
  const firstBlock = { verified: false, blocked: true, escalate: false, prUrl: '', branch: '', worktreePath: '', blockerDiagnosis: 'tests red on X', summary: '' }
  const r = await run(mkArgs(mkTask('proj-fix-p', { rung: 'opus-high', planGate: true })), {
    result: (l) => (l === 'implement:proj-fix-p' ? firstBlock : l === 'implement:proj-fix-p@opus-xhigh' ? BLOCKED_Q : {}),
  })
  assert.equal(r.error, undefined)
  assert.deepEqual(r.unknown, [])
  assert.deepEqual(r.labels, ['plan:proj-fix-p', 'plan-judge:proj-fix-p r1', 'implement:proj-fix-p', 'implement:proj-fix-p@opus-xhigh'],
    'one climb, one retry, then the stop: no review')
  const row = r.result.tasks[0]
  assert.equal(row.status, 'blocked')
  assert.deepEqual(row.climbs, [{ stage: 'implement', from: 'opus-high', to: 'opus-xhigh' }])
  assert.equal(row.needsHuman, Q, 'the retry\'s question, trimmed')
  assert.equal(row.blockerDiagnosis, Q)
  assert.equal(row.planRoundsUsed, 1)
})

test('p16-3: no question gives needsHuman "" (a plain run, a run that threw)', async () => {
  const plain = await run(mkArgs(mkTask('proj-fix-a')))
  assert.equal(plain.result.tasks[0].needsHuman, '')
  const blocked = await run(mkArgs(mkTask('proj-fix-a', { maxReviewRounds: 1 })), { review: () => 'changes' })
  assert.equal(blocked.result.tasks[0].needsHuman, '')
  const threw = await run(mkArgs(mkTask('proj-fix-a')), { throwOn: 'implement' })
  assert.equal(threw.result.tasks[0].blockerDiagnosis, THREW)
  assert.equal(threw.result.tasks[0].needsHuman, '')
})

// ---- p21-3: reviewVerdicts. Every master-review round this call judged, in order, each with its OWN bullets, pushed
// right after the judge returns (before any exit), so a call that stops after a `changes` round still carries
// that round's findings. reconcile turns each entry into one review-verdict Run-record event.
const H1 = 'a1'.repeat(20)
const H2 = 'b2'.repeat(20)
const B3 = ['a.py:2 the empty corpus', 'a.py:3 the off-by-one', 'no cite at all']

test('p21-3: r1 changes then r2 approve: one entry per judged round, with its head and its own bullets', async () => {
  const r = await run(mkArgs(mkTask('proj-fix-a')), {
    review: (l) => (l.endsWith(' r1') ? 'changes' : 'approve'),
    head: (l) => (l.endsWith(' r1') ? H1 : H2),
  })
  assert.equal(r.error, undefined)
  assert.deepEqual(r.unknown, [])
  const row = r.result.tasks[0]
  assert.equal(row.status, 'review')
  assert.deepEqual(row.reviewVerdicts, [
    { round: 1, verdict: 'changes', head: H1, feedback: ['fix review:proj-fix-a r1'] },
    { round: 2, verdict: 'approve', head: H2, feedback: [] },
  ])
})

test('p21-3: a reviser that blocks after r1 changes keeps r1\'s three bullets though reviewHistory is []', async () => {
  const r = await run(mkArgs(mkTask('proj-fix-a')), { review: () => 'changes', feedback: () => B3, reviseBlocked: true })
  assert.deepEqual(r.unknown, [])
  assert.deepEqual(r.labels, ['implement:proj-fix-a', 'review:proj-fix-a r1', 'revise:proj-fix-a r2'])
  const row = r.result.tasks[0]
  assert.equal(row.status, 'blocked')
  assert.deepEqual(row.reviewHistory, [], 'an unseeded stop carries no history')
  assert.equal(row.reviewVerdicts.length, 1)
  assert.deepEqual(row.reviewVerdicts[0], { round: 1, verdict: 'changes', head: '', feedback: B3 })
})

test('p21-3: a dead judge at r2 after r1 changes: one entry, r1, with its bullets; the dead round adds none', async () => {
  const r = await run(mkArgs(mkTask('proj-fix-a')), { review: () => 'changes', feedback: () => B3, dead: (l) => l === 'review:proj-fix-a r2' })
  assert.deepEqual(r.unknown, [])
  const row = r.result.tasks[0]
  assert.equal(row.status, 'blocked')
  assert.deepEqual(row.reviewVerdicts, [{ round: 1, verdict: 'changes', head: '', feedback: B3 }])
  const first = await run(mkArgs(mkTask('proj-fix-a')), { dead: (l) => l.startsWith('review:') })
  assert.equal(first.result.tasks[0].status, 'blocked')
  assert.deepEqual(first.result.tasks[0].reviewVerdicts, [], 'a dead judge adds no entry')
})

test('p21-3: a gate-pending reviser after r1 changes keeps r1\'s bullets', async () => {
  const r = await run(mkArgs(mkTask('proj-fix-a')), { review: () => 'changes', feedback: () => B3, reviseGates: ['spend: an API — cap $5'] })
  assert.deepEqual(r.unknown, [])
  const row = r.result.tasks[0]
  assert.equal(row.status, 'gate-pending')
  assert.deepEqual(row.reviewVerdicts.map((v) => [v.round, v.verdict, v.feedback.length]), [[1, 'changes', 3]])
})

test('p21-3: the head is a 7-40 hex string, lowercased; anything else (absent, non-hex, too short) is ""', async () => {
  for (const [head, want] of [[undefined, ''], ['--output=x', ''], ['abc12', ''], ['ABCDEF0', 'abcdef0'], [H1.toUpperCase(), H1], [7, ''], ['a'.repeat(41), '']]) {
    const r = await run(mkArgs(mkTask('proj-fix-a')), { head: () => head })
    assert.deepEqual(r.unknown, [])
    assert.deepEqual(r.result.tasks[0].reviewVerdicts, [{ round: 1, verdict: 'approve', head: want, feedback: [] }], JSON.stringify(head))
  }
  // an approve carries no bullets even when the judge sent some; a changes keeps only its string bullets
  const stray = await run(mkArgs(mkTask('proj-fix-a', { maxReviewRounds: 1 })), { review: () => 'changes', feedback: () => ['x.py:1 a', 7, null, 'b'] })
  assert.deepEqual(stray.result.tasks[0].reviewVerdicts[0].feedback, ['x.py:1 a', 'b'])
  const approveFb = await run(mkArgs(mkTask('proj-fix-a')), { feedback: () => ['stray'] })
  assert.deepEqual(approveFb.result.tasks[0].reviewVerdicts[0].feedback, [])
})

test('p21-3: no judged round gives []: read-only, the pre-flight budget block, plan-blocked; a throw after r1 keeps r1', async () => {
  const ro = await run(mkArgs(mkTask('proj-audit-x', { scope: 'read-only' })))
  assert.deepEqual(ro.result.tasks[0].reviewVerdicts, [])
  const pre = await run(mkArgs(mkTask('proj-fix-a', { maxReviewRounds: 0 })))
  assert.equal(pre.calls.length, 0)
  assert.deepEqual(pre.result.tasks[0].reviewVerdicts, [])
  const pb = await run(mkArgs(mkTask('proj-fix-p', { planGate: true, maxPlanRounds: 1 })), { planJudge: () => 'changes' })
  assert.equal(pb.result.tasks[0].status, 'plan-blocked')
  assert.deepEqual(pb.result.tasks[0].reviewVerdicts, [])
  const threw = await run(mkArgs(mkTask('proj-fix-a')), { review: () => 'changes', feedback: () => B3, throwOn: 'revise' })
  assert.equal(threw.result.tasks[0].blockerDiagnosis, THREW)
  assert.deepEqual(threw.result.tasks[0].reviewVerdicts, [{ round: 1, verdict: 'changes', head: '', feedback: B3 }])
})

// ---- ADR 0038: a Cap is a promise. The plan judge prices spend gates while args.gatePricer is set ---------------
// A judge `changes` whose every bullet is about spend gates the pricer could not price (`"usd": null`) names them in
// gateBounce; a priced gate whose sub-bullets break its Cap is an ordinary `changes` (C14). The engine validates the
// claim it can see (gateBounceOf: the plan's parsed spend gates, exactly one cap amount each), sends the plan back ONCE
// with no climb, and on a second bounce, or on the last plan round, takes the approve path: unapproved gates reach
// Lachy as gate-pending (with the `bounced by the plan judge (ADR 0038)` paragraph, which reconcile keeps from the
// standing approval, C15), never plan-blocked. Cases run on the bottom rung (opus-high) wherever a climb is observed.
// G never prices: the pricer reads `cap 30 AUD` as "no cap clause", which ADR 0038 decision 2 bounces once, then sends
// to sign-off.
const PRICER = '/home/x/.claude/plugins/cache/thread/thread/4.1.0/skills/_shared/scripts/gated_inputs.py'
const G = 'spend: eval re-runs — cap 30 AUD'
const planWith = (gates, marker = 'PLAN') => `Planned on: abc\n${marker}\n### Files to modify\n- x\n### Gated inputs\n${gates.map((g) => '- ' + g + '\n  - six runs at about four US dollars').join('\n')}\n### Risks / unknowns\n- none`
const PLAN_G = planWith([G])
const BOUNCED = 'bounced by the plan judge (ADR 0038)'
const GATE_DIAG = 'gated inputs await human sign-off (a declared gate always pauses — ADR 0008):\n'
const pricedArgs = (task, over = {}) => mkArgs(task, { gatePricer: PRICER, ...over })
const bottomGated = (over = {}) => mkTask('proj-cap-g', { rung: 'opus-high', planGate: true, ...over })
const ranOf = (r, label) => r.result.tasks[0].ran.find((x) => x.label === label)
const optsOf = (r, label) => (r.opts.find((x) => x.label === label) || {}).opts
const promptOf = (r, label) => (r.calls.find((c) => c.label === label) || {}).prompt
const CLIMB = [{ stage: 'plan', from: 'opus-high', to: 'opus-xhigh' }]
const PLAN_LABELS = ['plan:proj-cap-g', 'plan-judge:proj-cap-g r1', 'plan-revise:proj-cap-g r2', 'plan-judge:proj-cap-g r2']

test('ADR 0038 C1: with gatePricer, a gates-only `changes` is sent back with no climb; the r2 approve pauses at gate-pending', async () => {
  const r = await run(pricedArgs(bottomGated()), {
    plan: PLAN_G, planJudge: (l) => (l.endsWith(' r1') ? 'changes' : 'approve'), bounce: (l) => (l.endsWith(' r1') ? [G] : undefined),
  })
  assert.equal(r.error, undefined)
  assert.deepEqual(r.unknown, [])
  assert.deepEqual(r.labels, PLAN_LABELS)
  const row = r.result.tasks[0]
  assert.deepEqual([row.status, row.gatedInputs, row.planRoundsUsed, row.climbs], ['gate-pending', [G], 2, []])
  assert.equal(ranOf(r, 'plan-revise:proj-cap-g r2').effort, 'high', 'the revise runs on the rung the call is on')
  assert.ok(r.logs.includes('plan-judge:proj-cap-g r1: gate format only — sent back once, no climb (ADR 0038)'), r.logs.join('\n'))
  assert.ok(!row.blockerDiagnosis.includes(BOUNCED), 'a judge approve adds no bounce paragraph')
  assert.ok(optsOf(r, 'plan-judge:proj-cap-g r1').schema.properties.gateBounce, 'the priced schema carries gateBounce')
  const p1 = promptOf(r, 'plan-judge:proj-cap-g r1')
  assert.ok(p1.includes(`python3 -I '${PRICER}' exposure - <<'EOF'\n${G}\nEOF`), 'the judge gets the ready pricing command')
})

test('ADR 0038 C2 (control): the same `changes` with no gateBounce climbs', async () => {
  const r = await run(pricedArgs(bottomGated()), { plan: PLAN_G, planJudge: (l) => (l.endsWith(' r1') ? 'changes' : 'approve') })
  assert.deepEqual(r.unknown, [])
  assert.deepEqual(r.labels, PLAN_LABELS)
  assert.deepEqual(r.result.tasks[0].climbs, CLIMB)
  assert.equal(ranOf(r, 'plan-revise:proj-cap-g r2').effort, 'xhigh')
})

test('ADR 0038 C3: a second gates-only bounce takes the approve path — gate-pending with the bounce paragraph, no r3', async () => {
  const r = await run(pricedArgs(bottomGated()), { plan: PLAN_G, planJudge: () => 'changes', bounce: () => [G] })
  assert.deepEqual(r.unknown, [])
  assert.deepEqual(r.labels, PLAN_LABELS)
  const row = r.result.tasks[0]
  assert.deepEqual([row.status, row.gatedInputs, row.planRoundsUsed, row.climbs, row.plan], ['gate-pending', [G], 2, [], null])
  assert.ok(row.blockerDiagnosis.startsWith(GATE_DIAG + '- ' + G + '\n\n' + BOUNCED), row.blockerDiagnosis)
  assert.ok(row.blockerDiagnosis.includes('after one bounce') && row.blockerDiagnosis.includes('  - fix plan-judge:proj-cap-g r2'), row.blockerDiagnosis)
  assert.ok(row.blockerDiagnosis.endsWith(`${BOUNCED}: it still read these gates as unpriceable after one bounce, so they go to sign-off as written, never to the standing approval:\n  - ${G}\nits round-2 feedback:\n  - fix plan-judge:proj-cap-g r2`),
    'the paragraph names the flagged gates, then the feedback: ' + row.blockerDiagnosis)
  assert.ok(r.logs.includes('plan-judge:proj-cap-g r2: gate format only (bounced once already) — the gates go to sign-off (ADR 0038)'), r.logs.join('\n'))
})

test('ADR 0038 C4: a bounce on the last plan round (max_plan_rounds 1) is gate-pending, never plan-blocked', async () => {
  const r = await run(pricedArgs(bottomGated({ maxPlanRounds: 1 })), { plan: PLAN_G, planJudge: () => 'changes', bounce: () => [G] })
  assert.deepEqual(r.unknown, [])
  assert.deepEqual(r.labels, ['plan:proj-cap-g', 'plan-judge:proj-cap-g r1'])
  const row = r.result.tasks[0]
  assert.deepEqual([row.status, row.gatedInputs, row.planRoundsUsed, row.climbs], ['gate-pending', [G], 1, []])
  assert.ok(row.blockerDiagnosis.includes(BOUNCED) && row.blockerDiagnosis.includes('on the last plan round'), row.blockerDiagnosis)
})

test('ADR 0038 C5: a bounce naming a gate already signed still costs one revise round, then the approve implements', async () => {
  const r = await run(pricedArgs(bottomGated({ approvedGates: [G] })), {
    plan: PLAN_G, planJudge: (l) => (l.endsWith(' r1') ? 'changes' : 'approve'), bounce: (l) => (l.endsWith(' r1') ? [G] : undefined),
  })
  assert.deepEqual(r.unknown, [])
  assert.deepEqual(r.labels, [...PLAN_LABELS, 'implement:proj-cap-g', 'review:proj-cap-g r1'])
  assert.deepEqual([r.result.tasks[0].status, r.result.tasks[0].climbs], ['review', []])
})

test('ADR 0038 C5b: two bounces on a signed gate: the override takes the approve path and implements the r2 plan', async () => {
  const R2 = planWith([G], 'PLAN-R2-MARKER')
  const r = await run(pricedArgs(bottomGated({ approvedGates: [G] })), { plan: PLAN_G, revisedPlan: R2, planJudge: () => 'changes', bounce: () => [G] })
  assert.deepEqual(r.unknown, [])
  assert.deepEqual(r.labels, [...PLAN_LABELS, 'implement:proj-cap-g', 'review:proj-cap-g r1'])
  assert.ok(promptOf(r, 'implement:proj-cap-g').includes('PLAN-R2-MARKER'))
  const row = r.result.tasks[0]
  assert.deepEqual([row.status, row.planRoundsUsed, row.climbs, row.plan], ['review', 2, [], R2])
})

test('ADR 0038 C6: without gatePricer a gateBounce is ignored — it climbs, and the judge gets no fragment and PLAN_JUDGE', async () => {
  const r = await run(mkArgs(bottomGated()), {
    plan: PLAN_G, planJudge: (l) => (l.endsWith(' r1') ? 'changes' : 'approve'), bounce: (l) => (l.endsWith(' r1') ? [G] : undefined),
  })
  assert.deepEqual(r.unknown, [])
  assert.deepEqual(r.result.tasks[0].climbs, CLIMB)
  assert.ok(!promptOf(r, 'plan-judge:proj-cap-g r1').includes('exposure -'))
  assert.equal(optsOf(r, 'plan-judge:proj-cap-g r1').schema.properties.gateBounce, undefined)
  assert.ok(r.logs.every((l) => !l.includes('ADR 0038')))
})

test('ADR 0038 C7: a gateBounce naming a gate the plan lacks is an ordinary `changes` — it climbs', async () => {
  const r = await run(pricedArgs(bottomGated()), {
    plan: PLAN_G, planJudge: (l) => (l.endsWith(' r1') ? 'changes' : 'approve'),
    bounce: (l) => (l.endsWith(' r1') ? [G, 'spend: another API — cap 5 USD'] : undefined),
  })
  assert.deepEqual(r.unknown, [])
  assert.deepEqual(r.result.tasks[0].climbs, CLIMB)
})

test('ADR 0038 C7b: a capless or a two-cap spend gate is never a bounce (the cap backstop) — it climbs', async () => {
  for (const gate of ['spend: some API', 'spend: x — cap 5 USD and cap 3 USD', 'spend: y — cap TBD']) {
    const r = await run(pricedArgs(bottomGated()), {
      plan: planWith([gate]), planJudge: (l) => (l.endsWith(' r1') ? 'changes' : 'approve'), bounce: (l) => (l.endsWith(' r1') ? [gate] : undefined),
    })
    assert.deepEqual(r.unknown, [])
    assert.deepEqual(r.result.tasks[0].climbs, CLIMB, gate)
    assert.ok(r.logs.every((l) => !l.includes('no climb (ADR 0038)')), gate)
  }
})

test('ADR 0038 C8: a later mixed `changes` after a bounce climbs once', async () => {
  const r = await run(pricedArgs(bottomGated()), {
    plan: PLAN_G, planJudge: (l) => (l.endsWith(' r3') ? 'approve' : 'changes'), bounce: (l) => (l.endsWith(' r1') ? [G] : undefined),
  })
  assert.deepEqual(r.unknown, [])
  assert.deepEqual(r.labels, [...PLAN_LABELS, 'plan-revise:proj-cap-g r3', 'plan-judge:proj-cap-g r3'])
  const row = r.result.tasks[0]
  assert.deepEqual([row.status, row.climbs, row.planRoundsUsed], ['gate-pending', CLIMB, 3])
  assert.equal(ranOf(r, 'plan-revise:proj-cap-g r2').effort, 'high')
  assert.equal(ranOf(r, 'plan-revise:proj-cap-g r3').effort, 'xhigh')
})

test('ADR 0038 C9: the judge prices each parsed spend gate as the engine parsed it; a None or credential-only plan renders no block', async () => {
  const plan = 'Planned on: abc\n### Gated inputs\n1. spend: Replicate API for the full corpus —\n   cap 30 USD\n   - two re-renders\n- credential: PROD_API_KEY\n- Spend: `make evals` — cap $5\n### Risks'
  const r = await run(pricedArgs(bottomGated()), { plan })
  const p = promptOf(r, 'plan-judge:proj-cap-g r1')
  const block = (g) => `\`\`\`bash\npython3 -I '${PRICER}' exposure - <<'EOF'\n${g}\nEOF\n\`\`\``
  assert.ok(p.includes(block('spend: Replicate API for the full corpus — cap 30 USD')), 'a soft-wrap joined, its `1.` marker stripped')
  assert.ok(p.includes(block('Spend: `make evals` — cap $5')), 'a gate kind in any case, `$` and backticks literal')
  assert.equal(p.split("<<'EOF'").length - 1, 2, 'one block per spend gate, the credential gate never listed')
  assert.ok(!p.includes('credential: PROD_API_KEY\nEOF'))
  assert.ok(p.indexOf('Spend gate pricing (ADR 0038') > p.indexOf('the plan omits.') && p.indexOf('Spend gate pricing (ADR 0038') < p.indexOf('Task tree (hard rule'),
    'the fragment follows the Gated inputs bullet, before TASK_TREE_RULE')
  for (const none of [PLAN_TEXT, 'Planned on: abc\n### Gated inputs\n- credential: PROD_API_KEY\n### Risks']) {
    const q = await run(pricedArgs(bottomGated()), { plan: none })
    assert.ok(!promptOf(q, 'plan-judge:proj-cap-g r1').includes('Spend gate pricing'), none)
  }
})

test('ADR 0038 C10: an unusable gatePricer is logged once and read as absent, never a throw', async () => {
  for (const bad of ['relative/gated_inputs.py', 'C:\\x\\gated_inputs.py', "/tmp/it's/gated_inputs.py", '/x\\y/gated_inputs.py', '/x/other.py', 42]) {
    const r = await run(pricedArgs(bottomGated(), { gatePricer: bad }), {
      plan: PLAN_G, planJudge: (l) => (l.endsWith(' r1') ? 'changes' : 'approve'), bounce: (l) => (l.endsWith(' r1') ? [G] : undefined),
    })
    assert.equal(r.error, undefined, String(bad))
    assert.deepEqual(r.unknown, [])
    assert.equal(r.logs.filter((l) => l.startsWith('gatePricer: refusing ')).length, 1, String(bad))
    assert.ok(r.logs.includes(`gatePricer: refusing ${JSON.stringify(bad)} — the plan judge's pricing check is off for this call (ADR 0038)`))
    assert.ok(!promptOf(r, 'plan-judge:proj-cap-g r1').includes('exposure -'), String(bad))
    assert.equal(optsOf(r, 'plan-judge:proj-cap-g r1').schema.properties.gateBounce, undefined)
    assert.deepEqual(r.result.tasks[0].climbs, CLIMB, `${bad}: read as absent, the bounce is an ordinary changes`)
  }
  for (const absent of [undefined, null, '']) {
    const r = await run(mkArgs(bottomGated(), absent === undefined ? {} : { gatePricer: absent }), { plan: PLAN_G })
    assert.ok(r.logs.every((l) => !l.startsWith('gatePricer:')), String(absent))
  }
})

test('ADR 0038 C11: a signed-gate resume after two bounces replays identically and implements the r2 plan', async () => {
  const R1 = planWith([G], 'PLAN-R1-MARKER')
  const R2 = planWith([G], 'PLAN-R2-MARKER')
  const script = { plan: R1, revisedPlan: R2, planJudge: () => 'changes', bounce: () => [G] }
  const argsA = pricedArgs(bottomGated())
  const A = await run(argsA, script)
  assert.deepEqual(A.unknown, [])
  assert.deepEqual([A.result.tasks[0].status, A.result.tasks[0].gatedInputs, A.result.tasks[0].planRoundsUsed], ['gate-pending', [G], 2])
  const argsB = structuredClone(argsA)
  argsB.task.approvedGates = [G]
  const B = await run(argsB, script)
  assert.deepEqual(B.unknown, [])
  assert.deepEqual(B.labels, [...A.labels, 'implement:proj-cap-g', 'review:proj-cap-g r1'])
  assert.deepEqual(B.calls.slice(0, A.calls.length), A.calls, "A's calls are a byte-identical prefix of B's")
  const impl = promptOf(B, 'implement:proj-cap-g')
  assert.ok(impl.includes('PLAN-R2-MARKER') && !impl.includes('PLAN-R1-MARKER'), 'the implementer runs the r2 plan')
  const row = B.result.tasks[0]
  assert.deepEqual([row.status, row.planRoundsUsed, row.climbs], ['review', 2, []])
})

test('ADR 0038 C12: a gateBounce on an approve verdict is ignored and logged', async () => {
  const r = await run(pricedArgs(bottomGated()), { plan: PLAN_G, bounce: () => [G] })
  assert.deepEqual(r.unknown, [])
  assert.deepEqual(r.labels, ['plan:proj-cap-g', 'plan-judge:proj-cap-g r1'])
  const row = r.result.tasks[0]
  assert.deepEqual([row.status, row.gatedInputs], ['gate-pending', [G]])
  assert.ok(!row.blockerDiagnosis.includes(BOUNCED))
  assert.ok(r.logs.includes('plan-judge:proj-cap-g r1: gateBounce on an approve verdict ignored (ADR 0038)'), r.logs.join('\n'))
})

test('ADR 0038 C13: a question beside a gateBounce keeps its precedence — plan-blocked with the question', async () => {
  const r = await run(pricedArgs(bottomGated()), { plan: PLAN_G, planJudge: () => 'changes', bounce: () => [G], ask: () => 'Which Login pays?' })
  assert.deepEqual(r.unknown, [])
  assert.deepEqual(r.labels, ['plan:proj-cap-g', 'plan-judge:proj-cap-g r1'])
  const row = r.result.tasks[0]
  assert.deepEqual([row.status, row.needsHuman, row.climbs], ['plan-blocked', 'Which Login pays?', []])
})

// The reviewer's reproduction (p23-1 round 2): a gate whose own line prices (`cap 24 USD` -> {"usd": "24"}, under the
// US$50 standing limit) while its sub-bullet spends 40. The fragment allows gateBounce only for a gate the pricer could
// not price, so the judge's `changes` over it is ordinary: it climbs and ends plan-blocked, never the bounce override
// that would hand the gate to the standing approval. C15 is a judge that breaks that rule: the engine cannot see the
// pricer's output, so it bounces, and the note's `## Gate bounce (awaiting sign-off)` keeps the gate from the standing
// approval (reconcile-rollout-standing.test.sh S8 runs this row through reconcile and approve-gates --standing).
const G24 = 'spend: eval re-runs — cap 24 USD'
const PLAN_24 = `Planned on: abc\n### Files to modify\n- x\n### Gated inputs\n- ${G24}\n  - 10 invocations at --max-cost-usd 4 (40 USD)\n### Risks / unknowns\n- none`

test('ADR 0038 C14: a priced gate whose sub-bullets break its Cap, flagged on both rounds, is an ordinary `changes` — it climbs and ends plan-blocked', async () => {
  const r = await run(pricedArgs(bottomGated({ maxPlanRounds: 2 })), { plan: PLAN_24, planJudge: () => 'changes' })
  assert.equal(r.error, undefined)
  assert.deepEqual(r.unknown, [])
  assert.deepEqual(r.labels, PLAN_LABELS)
  const row = r.result.tasks[0]
  assert.deepEqual([row.status, row.gatedInputs, row.planRoundsUsed, row.climbs, row.plan], ['plan-blocked', [], 2, CLIMB, null])
  assert.ok(row.blockerDiagnosis.startsWith('plan not approved after 2 rounds.'), row.blockerDiagnosis)
  assert.ok(!row.blockerDiagnosis.includes(BOUNCED), 'no bounce paragraph: nothing for the standing approval to sign')
  assert.ok(r.logs.every((l) => !l.includes('gate format only')), r.logs.join('\n'))
  assert.equal(ranOf(r, 'plan-revise:proj-cap-g r2').effort, 'xhigh', 'the revise runs one rung up')
  const p1 = promptOf(r, 'plan-judge:proj-cap-g r1')
  assert.ok(p1.includes(`python3 -I '${PRICER}' exposure - <<'EOF'\n${G24}\nEOF`), 'the judge prices the line as parsed, without its sub-bullet')
  assert.ok(p1.includes('gateBounce is ONLY for gates whose "usd" printed\nnull') && p1.includes('Never list a gate whose "usd" is an amount'),
    'the fragment confines gateBounce to unpriced gates')
})

test('ADR 0038 C15: a judge that wrongly bounces the priced gate on both rounds: gate-pending whose bounce paragraph names it, for reconcile to keep from the standing approval', async () => {
  const r = await run(pricedArgs(bottomGated({ maxPlanRounds: 2 })), { plan: PLAN_24, planJudge: () => 'changes', bounce: () => [G24] })
  assert.deepEqual(r.unknown, [])
  assert.deepEqual(r.labels, PLAN_LABELS)
  const row = r.result.tasks[0]
  assert.deepEqual([row.status, row.gatedInputs, row.planRoundsUsed, row.climbs], ['gate-pending', [G24], 2, []])
  assert.ok(row.blockerDiagnosis.startsWith(GATE_DIAG + '- ' + G24 + '\n\n' + BOUNCED + ':'), row.blockerDiagnosis)
  assert.ok(row.blockerDiagnosis.includes(`never to the standing approval:\n  - ${G24}\nits round-2 feedback:\n  - fix plan-judge:proj-cap-g r2`), row.blockerDiagnosis)
})
