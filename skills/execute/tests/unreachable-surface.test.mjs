// p52-1 (ADR 0081 d1): a task declares an Unreachable surface, and the repo's path list backs it up.
// p52-2 (ADR 0081 d2): a marked task's master review is doubled.
//
// The plan declares it (PLAN_VERDICT's unreachable), the plan judge checks the declaration with its own reading of the
// plan's files (PLAN_JUDGE's), a task with no plan declares it in its code-writing agent's result (IMPL_RESULT's), and a
// changed path under args.unreachablePaths marks the task whatever its plan says. The row's `unreachable` carries the
// mark. A marked task (or one whose note's stamp comes in as task.unreachable) has every master-review round from then
// on judged by two independent reviewers, `first-review:` then `review:`, and approves only when both do. These run the
// whole engine through tests/lib/engine.mjs runTask() with a scripted `agent`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runTask, loadEngine, VERIFY_SLOT } from '../../../tests/lib/engine.mjs'

const PLAN_TEXT = 'Planned on: abc\n### Files to modify\n- x\n### Gated inputs\nNone'
const mkArgs = (task, over = {}) => ({
  rolloutSlug: 'proj-rollout-2026-11-12', repoPath: '/repo', verifier: 'make test', date: '2026-11-12',
  verifySlot: VERIFY_SLOT,
  task: { slug: 'proj-fix-u', taskPath: '/vault/Tasks/proj-fix-u.md', scope: 'cross-cutting', planGate: false,
    maxIterations: 3, maxReviewRounds: 3, maxPlanRounds: 3, rung: 'opus-xhigh', ...task },
  ...over,
})
// s: { plan, judge, result, files, reviews, firstReviews, firstDead, revised }: what the planner, the plan judge and the
// implementer return for unreachable, the implementer's changedFiles (absent ⇒ the key is left out, as an older agent
// returns it), the second reviewer's (`review:`) and the first reviewer's (`first-review:`) verdicts in order (absent or
// used up ⇒ approve; each a verdict string or { verdict, feedback, needsHuman, head }), firstDead ('fable': a first
// reviewer on fable returns null; 'all': every first reviewer does) and the reviser's own { result, files }.
const PR = 'https://github.com/o/r/pull/1'
const BR = 'audit-fix/fix-u'
const WT = '/repo/.claude/worktrees/proj-fix-u'
const verdictOf = (v) => {
  const o = typeof v === 'object' && v ? v : { verdict: v || 'approve' }
  return { feedback: o.verdict === 'changes' ? ['fix the edge case'] : [], ...o }
}
function agentOf(s) {
  const reviews = [...(s.reviews || [])]
  const firsts = [...(s.firstReviews || [])]
  const impl = (o) => ({
    verified: true, blocked: false, escalate: false, prUrl: PR, branch: BR, worktreePath: WT, blockerDiagnosis: '', summary: 'done',
    ...(o.result === undefined ? {} : { unreachable: o.result }), ...(o.files === undefined ? {} : { changedFiles: o.files }),
  })
  return async (prompt, opts) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'plan') return { ready: true, blocked: false, blockerCause: '', plan: PLAN_TEXT, ...(s.plan === undefined ? {} : { unreachable: s.plan }) }
    if (kind === 'plan-judge') return { verdict: 'approve', feedback: [], ...(s.judge === undefined ? {} : { unreachable: s.judge }) }
    if (kind === 'review') return verdictOf(reviews.shift())
    if (kind === 'first-review') {
      if (s.firstDead === 'all' || (s.firstDead === 'fable' && opts.model === 'fable')) return null
      return verdictOf(firsts.shift())
    }
    if (kind === 'implement') return impl(s)
    if (kind === 'revise') return impl(s.revised || {})
    throw new Error('unscripted label ' + opts.label)
  }
}
// A seeded revise (task.resume, after an Integration rejection): its first call approved a plan this call never sees.
const RESUME = { stage: 'revise', prUrl: PR, branch: BR, worktreePath: WT, reviewHistory: [{ round: 1, feedback: ['keep their rename'] }],
  reviewRoundsUsed: 1, plan: PLAN_TEXT }
const NOT = { marked: false, by: [], paths: [] }
const GLOBS = ['skills/codex/**', 'Apps/**/*.swift']
const S = 'proj-fix-u'
// A run's dispatch labels, and its master-review ones (first-review: and review:) alone.
const labels = (r) => r.calls.map((c) => c.label)
const reviewLabels = (r) => labels(r).filter((l) => /^(first-)?review:/.test(l))
// The master-review labels of rounds `rounds`, doubled (first-review: before each review:) or single.
const reviewsOf = (rounds, doubled) => rounds.flatMap((n) => (doubled ? [`first-review:${S} r${n}`, `review:${S} r${n}`] : [`review:${S} r${n}`]))

test('the row carries the mark: a declaring plan, its judge, a no-plan result, a listed diff; an unlisted, undeclared task is not', async () => {
  for (const [name, task, s, over, want, seq] of [
    ['a plan that declares it', { planGate: true }, { plan: true, judge: false, files: ['x.js'] }, { unreachablePaths: GLOBS },
      { marked: true, by: ['plan'], paths: [] }],
    ['a silent plan its judge reads as unreachable', { planGate: true }, { plan: false, judge: true }, {},
      { marked: true, by: ['plan-judge'], paths: [] }],
    ['a task with no plan whose implementer declares it', {}, { result: true }, {}, { marked: true, by: ['result'], paths: [] }],
    ['a diff under a listed path, the plan silent', { planGate: true }, { plan: false, judge: false, files: ['README.md', 'skills/codex/cu.py', 'Apps/Panel/V.swift'] },
      { unreachablePaths: GLOBS }, { marked: true, by: ['paths'], paths: ['Apps/Panel/V.swift', 'skills/codex/cu.py'] }],
    ['an unlisted, undeclared task', { planGate: true }, { plan: false, judge: false, files: ['skills/codexx/a.py', 'Apps/a.js'] },
      { unreachablePaths: GLOBS }, NOT],
    ['an approved plan wins over its implementer\'s declaration', { planGate: true }, { plan: false, judge: false, result: true }, {}, NOT],
    ['no list: a changed path marks nothing', {}, { result: false, files: ['skills/codex/cu.py'] }, {}, NOT],
    ['an older agent that returns neither field', {}, {}, { unreachablePaths: GLOBS }, NOT],
    // Sticky: the reviser after a `changes` round declares false and reports no file, and clears neither reading.
    ['a reviser\'s false and [] after a declaring implementer on a listed path', {},
      { result: true, files: ['skills/codex/cu.py'], reviews: ['changes'], firstReviews: ['approve', 'approve'], revised: { result: false, files: [] } },
      { unreachablePaths: GLOBS }, { marked: true, by: ['result', 'paths'], paths: ['skills/codex/cu.py'] },
      ['implement', 'first-review r1', 'review r1', 'revise r2', 'first-review r2', 'review r2']],
    // A seeded revise settles no plan, so its reviser's own declaration counts, even on a plan-gated task.
    ['a seeded revise whose reviser declares it', { planGate: true, resume: RESUME }, { revised: { result: true, files: ['x.js'] } },
      { unreachablePaths: GLOBS }, { marked: true, by: ['result'], paths: [] }, ['revise r2', 'first-review r2', 'review r2']],
  ]) {
    const r = await runTask(mkArgs(task, over), agentOf(s))
    assert.equal(r.error, undefined, name)
    const row = r.result.tasks[0]
    assert.equal(row.status, 'review', name)
    assert.deepEqual(row.unreachable, want, name)
    assert.equal(r.logs.some((l) => l.startsWith('unreachable surface: proj-fix-u')), want.marked, `${name}: the log line`)
    // p52-2: a marked task's every round has a first reviewer before its review; an unmarked one has none.
    const rounds = [...new Set(reviewLabels(r).map((l) => Number(l.split(' r')[1])))]
    assert.deepEqual(reviewLabels(r), reviewsOf(rounds, want.marked), `${name}: the master-review labels`)
    if (seq) assert.deepEqual(labels(r).map((l) => l.replace(`:${S}`, '')), seq, `${name}: the labels`)
  }
})

// ---- p52-2 (ADR 0081 d2): the doubled master review ---------------------------------------------------------------

// The built-in ladder's two rungs (the task starts on opus-xhigh, whose review effort is xhigh), with what a test adds.
const RUNGS = [
  { name: 'opus-high', model: 'opus', effort: 'high', judge: 'high', review: 'xhigh' },
  { name: 'opus-xhigh', model: 'opus', effort: 'xhigh', judge: 'high', review: 'xhigh' },
]
const ladder = (more) => ({ ladder: { source: '/x/ladder.toml', rungs: RUNGS, ...more } })
// A task marked by its no-plan implementer's declaration (by: ['result']).
const MARKED = { result: true }
// The { model, effort } each master-review dispatch ran on, by its label (the row's ran).
const ranOn = (row) => Object.fromEntries(row.ran.filter((x) => /^(first-)?review:/.test(x.label)).map((x) => [x.label.replace(`:${S}`, ''), `${x.model}/${x.effort}`]))

test('who reviews a marked task: Fable first when the file names it, outside the draw; else both on the task\'s rung', async () => {
  for (const [name, over, task, want] of [
    // A [share] for the master review names Fable: the first reviewer runs on it; the second on the rung, its arm ignored.
    ['a master-review share', ladder({ share: { 'master-review': 0.5 } }), { arms: { 'master-review': 'fable' } },
      { 'first-review r1': 'fable/high', 'review r1': 'opus/xhigh' }],
    ['the master review\'s role model', ladder({ roles: { 'master-review': 'fable' } }), {},
      { 'first-review r1': 'fable/high', 'review r1': 'fable/high' }],
    // No Fable to call (settled review #6): both on the task's rung, never the Top rung.
    ['the built-in ladder', {}, {}, { 'first-review r1': 'opus/xhigh', 'review r1': 'opus/xhigh' }],
    ['a share of 0', ladder({ share: { 'master-review': 0, builder: 0.5 } }), { rung: 'opus-high' },
      { 'first-review r1': 'opus/xhigh', 'review r1': 'opus/xhigh' }],
    // An all-Fable rung runs every role: both reviewers take it.
    ['an all-Fable rung', ladder({ rungs: [...RUNGS, { name: 'fable-top', model: 'fable', effort: 'high', judge: 'high', review: 'max' }],
      share: { 'master-review': 0.5 } }), { rung: 'fable-top' }, { 'first-review r1': 'fable/max', 'review r1': 'fable/max' }],
  ]) {
    const r = await runTask(mkArgs(task, over), agentOf(MARKED))
    assert.equal(r.error, undefined, name)
    const row = r.result.tasks[0]
    assert.equal(row.status, 'review', name)
    assert.deepEqual(ranOn(row), want, name)
    assert.deepEqual(reviewLabels(r), reviewsOf([1], true), name)
  }
})

test('an unmarked task is unchanged: one review a round, its arm honoured, no first reviewer and no doubled block', async () => {
  const r = await runTask(mkArgs({ arms: { 'master-review': 'fable' } }, ladder({ share: { 'master-review': 0.5 } })),
    agentOf({ reviews: ['changes'] }))
  const row = r.result.tasks[0]
  assert.equal(row.status, 'review')
  assert.deepEqual(row.unreachable, NOT)
  assert.deepEqual(reviewLabels(r), reviewsOf([1, 2], false))
  assert.deepEqual(ranOn(row), { 'review r1': 'fable/high', 'review r2': 'fable/high' })
  assert.ok(r.calls.every((c) => !c.prompt.includes('Unreachable surface (ADR 0081)')), 'no prompt carries the doubled block')
})

test('both must approve: either one\'s changes is the round\'s, with both reviewers\' bullets, one combined verdict a round', async () => {
  const r = await runTask(mkArgs({}), agentOf({ ...MARKED,
    firstReviews: [{ verdict: 'approve', head: 'zz' }], reviews: [{ verdict: 'changes', feedback: ['second: a.js:3 drops the error'], head: 'ABCDEF1' }] }))
  const row = r.result.tasks[0]
  assert.equal(row.status, 'review')
  assert.equal(row.reviewRoundsUsed, 2)
  assert.deepEqual(reviewLabels(r), reviewsOf([1, 2], true))
  assert.deepEqual(row.reviewVerdicts, [
    { round: 1, verdict: 'changes', head: 'abcdef1', feedback: ['second: a.js:3 drops the error'] },
    { round: 2, verdict: 'approve', head: '', feedback: [] },
  ])
  assert.ok(r.calls.find((c) => c.label === `revise:${S} r2`).prompt.includes('second: a.js:3 drops the error'), 'the reviser holds the bullet')
  assert.ok(r.logs.includes(`review: ${S} r1: first approve on opus, second changes on opus`), r.logs.join('\n'))
  // Both say changes, one bullet shared: the first's bullets then the second's, the shared one once.
  const b = await runTask(mkArgs({ maxReviewRounds: 1 }), agentOf({ ...MARKED,
    firstReviews: [{ verdict: 'changes', feedback: ['shared', 'first only'] }], reviews: [{ verdict: 'changes', feedback: ['second only', 'shared'] }] }))
  const brow = b.result.tasks[0]
  assert.equal(brow.status, 'review-blocked')
  assert.deepEqual(brow.reviewFeedback, ['shared', 'first only', 'second only'])
  assert.deepEqual(brow.reviewVerdicts.map((v) => v.round), [1])
})

test('a question from either reviewer that says changes ends review-blocked with it; one on an approve is ignored', async () => {
  for (const [name, s, want] of [
    ['the first asks', { firstReviews: [{ verdict: 'changes', needsHuman: 'Which device?' }] }, 'Which device?'],
    ['the second asks', { reviews: [{ verdict: 'changes', needsHuman: 'Which login?' }] }, 'Which login?'],
  ]) {
    const r = await runTask(mkArgs({}), agentOf({ ...MARKED, ...s }))
    const row = r.result.tasks[0]
    assert.equal(row.status, 'review-blocked', name)
    assert.equal(row.needsHuman, want, name)
    assert.deepEqual(reviewLabels(r), reviewsOf([1], true), `${name}: no further round`)
  }
  const r = await runTask(mkArgs({}), agentOf({ ...MARKED, firstReviews: [{ verdict: 'approve', needsHuman: 'ignored?' }] }))
  assert.equal(r.result.tasks[0].status, 'review')
  assert.ok(r.logs.includes(`review:${S} r1: needsHuman on an approve verdict ignored`))
})

test('a dead first reviewer on Fable runs once more on the rung; a dead rerun or second reviewer is the transient block', async () => {
  const over = ladder({ share: { 'master-review': 0.5 } })
  // The rerun takes the rung's own model whichever names Fable; under [role] the second reviewer stays on Fable.
  for (const [name, o, second] of [
    ['a master-review share', over, 'opus/xhigh'],
    ['the master review\'s role model', ladder({ roles: { 'master-review': 'fable' } }), 'fable/high'],
  ]) {
    const r = await runTask(mkArgs({}, o), agentOf({ ...MARKED, firstDead: 'fable' }))
    const row = r.result.tasks[0]
    assert.equal(row.status, 'review', name)
    assert.deepEqual(reviewLabels(r), [`first-review:${S} r1`, `first-review:${S} r1`, `first-review:${S} r1 on-rung`, `review:${S} r1`], name)
    assert.deepEqual(ranOn(row), { 'first-review r1': 'fable/high', 'first-review r1 on-rung': 'opus/xhigh', 'review r1': second }, name)
    assert.ok(r.logs.includes(`review: ${S} r1: the first reviewer on fable died; once more on the rung's opus`), `${name}: ${r.logs.join('\n')}`)
    assert.ok(r.logs.includes(`review: ${S} r1: first approve on opus, second approve on ${second.split('/')[0]}`), `${name}: ${r.logs.join('\n')}`)
  }
  for (const [name, s, last] of [
    ['a dead rerun', { firstDead: 'all' }, `first-review:${S} r1 on-rung`],
    ['a dead second reviewer', { reviews: [null] }, `review:${S} r1`],
  ]) {
    const agent = agentOf({ ...MARKED, ...s })
    const d = await runTask(mkArgs({}, over), s.reviews ? async (p, o) => (o.label.startsWith('review:') ? null : agent(p, o)) : agent)
    const drow = d.result.tasks[0]
    assert.equal(drow.status, 'blocked', name)
    assert.match(drow.blockerDiagnosis, /transient infrastructure failure/, name)
    assert.equal(reviewLabels(d).at(-1), last, name)
  }
})

test('a seeded revise of a marked task: doubled by task.unreachable, its prompts naming the earlier call', async () => {
  const r = await runTask(mkArgs({ planGate: true, resume: RESUME, unreachable: true }), agentOf({ revised: { result: false, files: [] } }))
  const row = r.result.tasks[0]
  assert.equal(row.status, 'review')
  assert.deepEqual(row.unreachable, NOT)
  assert.deepEqual(labels(r).map((l) => l.replace(`:${S}`, '')), ['revise r2', 'first-review r2', 'review r2'])
  for (const c of r.calls.filter((x) => /^(first-)?review:/.test(x.label))) {
    assert.ok(c.prompt.includes('Unreachable surface (ADR 0081): this task changes code that no check in the rollout\'s verifier exercises (marked by an earlier call of this task).'), c.label)
  }
  // This call's own mark names what marked it.
  const m = await runTask(mkArgs({}, { unreachablePaths: GLOBS }), agentOf({ result: true, files: ['skills/codex/cu.py'] }))
  assert.ok(m.calls.find((c) => c.label === `review:${S} r1`).prompt.includes('(marked by result, paths: skills/codex/cu.py)'))
})

test('the doubled block sits only in a doubled round\'s prompts, right after the security block, both reviewers alike', async () => {
  const r = await runTask(mkArgs({}), agentOf({ ...MARKED, reviews: ['changes'] }))
  const first = r.calls.find((c) => c.label === `first-review:${S} r1`).prompt
  const second = r.calls.find((c) => c.label === `review:${S} r1`).prompt
  assert.equal(first, second)
  assert.ok(first.includes('A second reviewer reads this PR on its own, and the round approves only when both of you approve.'))
  for (const c of r.calls.filter((x) => !/^(first-)?review:/.test(x.label))) assert.ok(!c.prompt.includes('Unreachable surface (ADR 0081)'), c.label)
  const { reviewJudgePrompt, rungState, unreachableReviewBlock } = loadEngine(['reviewJudgePrompt', 'rungState', 'unreachableReviewBlock'])
  const a = mkArgs({})
  const plain = reviewJudgePrompt(a.task, { prUrl: PR }, a, [])
  assert.equal(plain, reviewJudgePrompt(a.task, { prUrl: PR }, a, [], ''), "'' is the default")
  assert.ok(!plain.includes('Unreachable surface'), 'an undoubled prompt carries none')
  // The order, with the Security check on: the security block's last line, the doubled block, then the diff read.
  const sa = mkArgs({}, { securityCheck: { script: '/plug/skills/execute/scripts/security-check.py' } })
  const doubled = reviewJudgePrompt(sa.task, { prUrl: PR }, sa, [], unreachableReviewBlock(rungState(sa.task, sa)))
  const at = ['compared only on the part shown.', 'Unreachable surface (ADR 0081)', `Read \`gh pr diff ${PR}\``].map((x) => doubled.indexOf(x))
  assert.ok(at[0] > 0 && at[0] < at[1] && at[1] < at[2], `the order: ${at}`)
  assert.ok(doubled.includes('compared only on the part shown.\n\nUnreachable surface (ADR 0081)'), 'right after the security block')
})

// The JS port of inert-paths.py's glob_match, at its own layer: tests/inert-paths.test.mjs's 'glob_match agrees with git
// on the glob forms' rows, verbatim, then a `[!x]` class and `?`, so a drift in the port fails here, by its row.
test('unreachableGlobMatch reads each glob form as inert-paths.py\'s glob_match does', () => {
  const { unreachableGlobMatch } = loadEngine(['unreachableGlobMatch'])
  for (const [glob, path, want] of [
    ['THREAD.md', 'THREAD.md', true], ['THREAD.md', 'a/THREAD.md', false], ['docs/handoffs/**', 'docs/handoffs/a.md', true],
    ['docs/handoffs/**', 'docs/handoffs/x/y.md', true], ['docs/handoffs/**', 'docs/handoffsx/a.md', false], ['docs/*.md', 'docs/a.md', true],
    ['docs/*.md', 'docs/x/a.md', false], ['**/THREAD.md', 'THREAD.md', true], ['**/THREAD.md', 'a/b/THREAD.md', true],
    ['docs/**/x.md', 'docs/x.md', true],
    ['src/[!x]y.py', 'src/ay.py', true], ['src/[!x]y.py', 'src/xy.py', false],
    ['src/?.py', 'src/a.py', true], ['src/?.py', 'src/ab.py', false], ['a?b', 'a/b', false],
  ]) assert.equal(unreachableGlobMatch(glob, path), want, `${glob} on ${path}`)
})

test('the declaration rides each schema: required of the planner, the plan judge and every code-writing agent', () => {
  const E = loadEngine(['PLAN_VERDICT', 'PLAN_JUDGE', 'PLAN_JUDGE_PRICED', 'IMPL_RESULT', 'IMPL_RESULT_SECURED'])
  for (const [name, schema, keys] of [
    ['PLAN_VERDICT', E.PLAN_VERDICT, ['unreachable']], ['PLAN_JUDGE', E.PLAN_JUDGE, ['unreachable']],
    ['PLAN_JUDGE_PRICED', E.PLAN_JUDGE_PRICED, ['unreachable']],
    ['IMPL_RESULT', E.IMPL_RESULT, ['unreachable', 'changedFiles']], ['IMPL_RESULT_SECURED', E.IMPL_RESULT_SECURED, ['unreachable', 'changedFiles']],
  ]) {
    for (const k of keys) {
      assert.ok(schema.required.includes(k), `${name} requires ${k}`)
      assert.match(schema.properties[k].description, k === 'changedFiles' ? /gh pr diff <your PR> --name-only/ : /Unreachable surface, ADR 0081/, `${name}.${k}`)
    }
  }
})
