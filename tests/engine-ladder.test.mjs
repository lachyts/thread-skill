// p13-2 (ADR 0029 decisions 3 to 7): the engine climbs the operator's ladder.
//
// The ladder arrives in each Workflow call's args (`args.ladder`, ladder.py's JSON, resolved by the lead at the
// call's start); with none, the built-in ladder applies. A task starts on its `rung:` (default the bottom rung;
// a name the ladder lacks reads as the top rung and is reported as drift). Each stage (plan, implement, review)
// climbs one rung at its first evidence of hardness, once per call, never past the top; on the top rung a climb
// is a recorded no-op. Below the top a stage's first pass verifies one-shot; the retry after a real climb and
// every pass on the top rung run the full Ralph loop, and a top-rung retry keeps CAPPED_RETRY_ITERATIONS. Judges
// run on the current rung. Integration runs on the top rung. The row records startRung, rung, climbs, rungDrift
// and what each dispatch ran.
//
// The ladders here are ladder.py's real output under a temp HOME, fed in as args.ladder, and the whole script
// runs through tests/lib/engine.mjs runTask() with a label-keyed agent stub that records every dispatch's opts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runTask, loadEngine, enginePath } from './lib/engine.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LADDER_PY = path.join(root, 'skills', '_shared', 'scripts', 'ladder.py')
const J = (x) => JSON.parse(JSON.stringify(x))
const THREW = 'workflow stage threw — see /workflows'
const PLAN_TEXT = 'Planned on: abc\n### Files to modify\n- x\n### Gated inputs\nNone'

// ---- ladders: ladder.py's own output ------------------------------------------------------------------

function rungToml(r) {
  return `[[rung]]\nname = "${r.name}"\nmodel = "${r.model}"\neffort = "${r.effort}"\njudge = "${r.judge}"\nreview = "${r.review}"\n`
}
// ladder.py run under a temp HOME holding `rungs` as its ladder.toml (none: no file, the built-in ladder).
function ladderFrom(t, rungs) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-ladder-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  if (rungs) {
    const p = path.join(home, '.config', 'thread', 'ladder.toml')
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, rungs.map(rungToml).join('\n'))
  }
  const r = spawnSync('python3', ['-B', LADDER_PY], { encoding: 'utf8', env: { ...process.env, HOME: home, PYTHONDONTWRITEBYTECODE: '1' } })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}
const THREE = [
  { name: 'opus-high', model: 'opus', effort: 'high', judge: 'medium', review: 'high' },
  { name: 'opus-xhigh', model: 'opus', effort: 'xhigh', judge: 'high', review: 'xhigh' },
  { name: 'fable-high', model: 'fable', effort: 'high', judge: 'xhigh', review: 'max' },
]
const ONE = [{ name: 'solo', model: 'opus', effort: 'high', judge: 'high', review: 'xhigh' }]

// ---- the run harness ----------------------------------------------------------------------------------

const mkTask = (slug, over = {}) => ({
  slug, taskPath: `/vault/Tasks/${slug}.md`, scope: 'single-file', planGate: false,
  maxIterations: 3, maxReviewRounds: 3, maxPlanRounds: 3, ...over,
})
const mkArgs = (task, over = {}) => ({
  rolloutSlug: 'proj-rollout-2026-10-03', repoPath: '/repo', verifier: 'make test', date: '2026-10-03', task, ...over,
})
const green = (label) => {
  const s = label.split(':')[1].split(/[ @]/)[0]
  return { verified: true, blocked: false, escalate: false, prUrl: `https://github.com/o/r/pull/${s.length}`, branch: `audit-fix/${s}`, worktreePath: `/repo/.claude/worktrees/${s}`, blockerDiagnosis: '', summary: `${label} done` }
}
const redOneShot = { verified: false, blocked: false, escalate: true, prUrl: '', branch: 'b', worktreePath: '/wt', blockerDiagnosis: 'one-shot red', summary: 'tried' }
const ralphBlocked = { verified: false, blocked: true, escalate: false, prUrl: '', branch: 'b', worktreePath: '/wt', blockerDiagnosis: 'red after the loop', summary: '' }
const approve = { verdict: 'approve', feedback: [] }
const changes = (f) => ({ verdict: 'changes', feedback: [f] })
const plan = { ready: true, blocked: false, blockerCause: '', plan: PLAN_TEXT }
const noPlan = { ready: false, blocked: false, blockerCause: 'first planner produced no plan', plan: '' }

// script[label]: a result, an Error to throw, or a function (prompt, opts) → result. Any other label throws.
async function run(args, script) {
  const unknown = []
  const calls = []
  const out = await runTask(args, async (prompt, o) => {
    calls.push({ label: o.label, model: o.model, effort: o.effort, phase: o.phase, prompt })
    if (!(o.label in script)) { unknown.push(o.label); throw new Error('stub: unknown agent label ' + o.label) }
    const v = script[o.label]
    if (v instanceof Error) throw v
    return typeof v === 'function' ? v(prompt, o) : v
  })
  return { ...out, unknown, calls, labels: calls.map((c) => c.label), row: out.result && out.result.tasks[0] }
}
const clean = (r) => {
  assert.equal(r.error, undefined, String(r.error && r.error.stack))
  assert.deepEqual(r.unknown, [])
}
const callOf = (r, label) => r.calls.find((c) => c.label === label)
const me = (r, label) => { const c = callOf(r, label); return c && [c.model, c.effort] }
const ranOf = (r) => r.calls.map((c) => ({ label: c.label, model: c.model, effort: c.effort }))
const oneShot = (p) => p.includes('ONE-SHOT') && p.includes('EXACTLY ONCE') && !p.includes('Max iterations')

// ---- Lachy's two-rung ladder (the built-in one, no file) ----------------------------------------------

test('built-in: a bottom start runs one-shot at opus-high, climbs to opus-xhigh on red, and records it', async (t) => {
  const ladder = ladderFrom(t, null)
  assert.equal(ladder.source, 'built-in')
  const S = 'proj-two'
  const r = await run(mkArgs(mkTask(S), { ladder }), {
    [`implement:${S}`]: redOneShot,
    [`implement:${S}@opus-xhigh`]: green(`implement:${S}@opus-xhigh`),
    [`review:${S} r1`]: approve,
  })
  clean(r)
  assert.deepEqual(r.labels, [`implement:${S}`, `implement:${S}@opus-xhigh`, `review:${S} r1`])
  assert.deepEqual(me(r, `implement:${S}`), ['opus', 'high'])
  assert.ok(oneShot(callOf(r, `implement:${S}`).prompt), 'the bottom-rung first pass verifies one-shot')
  const retry = callOf(r, `implement:${S}@opus-xhigh`).prompt
  assert.deepEqual(me(r, `implement:${S}@opus-xhigh`), ['opus', 'xhigh'])
  assert.ok(retry.includes('Max iterations: 3') && !retry.includes('EXACTLY ONCE'), 'the retry after a real climb runs the full loop with the full budget')
  assert.ok(retry.includes('ESCALATION: you take this task over ONE RUNG UP') && !retry.includes('SECOND PASS'), 'a real climb is framed as a takeover one rung up')
  assert.deepEqual(me(r, `review:${S} r1`), ['opus', 'xhigh'], 'the review runs on the reached rung at its review effort')
  const row = r.row
  assert.equal(row.status, 'review')
  assert.deepEqual([row.startRung, row.rung, row.rungDrift], ['opus-high', 'opus-xhigh', ''])
  assert.deepEqual(row.climbs, [{ stage: 'implement', from: 'opus-high', to: 'opus-xhigh' }])
  assert.deepEqual(row.ran, [
    { label: `implement:${S}`, rung: 'opus-high', model: 'opus', effort: 'high' },
    { label: `implement:${S}@opus-xhigh`, rung: 'opus-xhigh', model: 'opus', effort: 'xhigh' },
    { label: `review:${S} r1`, rung: 'opus-xhigh', model: 'opus', effort: 'xhigh' },
  ])
  assert.deepEqual(row.ran.map((x) => ({ label: x.label, model: x.model, effort: x.effort })), ranOf(r), 'ran is every dispatch, as dispatched')
  assert.ok(r.logs.includes('ladder: built-in — opus-high, opus-xhigh'), r.logs.join('\n'))
  assert.ok(r.logs.includes(`climb: ${S} → opus-xhigh (implement)`), r.logs.join('\n'))
})

test('built-in: a clean plan-gated bottom task runs every role at the bottom rung and climbs nothing', async (t) => {
  const ladder = ladderFrom(t, null)
  const S = 'proj-clean'
  const r = await run(mkArgs(mkTask(S, { scope: 'cross-cutting', planGate: true }), { ladder }), {
    [`plan:${S}`]: plan, [`plan-judge:${S} r1`]: approve, [`implement:${S}`]: green(`implement:${S}`), [`review:${S} r1`]: approve,
  })
  clean(r)
  assert.deepEqual(r.calls.map((c) => [c.label, c.model, c.effort]), [
    [`plan:${S}`, 'opus', 'high'], [`plan-judge:${S} r1`, 'opus', 'high'], [`implement:${S}`, 'opus', 'high'], [`review:${S} r1`, 'opus', 'xhigh'],
  ])
  assert.ok(oneShot(callOf(r, `implement:${S}`).prompt))
  assert.deepEqual([r.row.startRung, r.row.rung, r.row.climbs], ['opus-high', 'opus-high', []])
})

// ---- a three-rung file -----------------------------------------------------------------------------------

test('three rungs: each stage climbs once; a middle-rung first pass is still one-shot; the top review climb is a no-op', async (t) => {
  const ladder = ladderFrom(t, THREE)
  assert.match(ladder.source, /ladder\.toml$/)
  const S = 'proj-three'
  const r = await run(mkArgs(mkTask(S, { scope: 'cross-cutting', planGate: true }), { ladder }), {
    [`plan:${S}`]: plan,
    [`plan-judge:${S} r1`]: changes('tighten the plan'),
    [`plan-revise:${S} r2`]: plan,
    [`plan-judge:${S} r2`]: changes('still loose'),
    [`plan-revise:${S} r3`]: plan,
    [`plan-judge:${S} r3`]: approve,
    [`implement:${S}`]: redOneShot,
    [`implement:${S}@fable-high`]: green(`implement:${S}@fable-high`),
    [`review:${S} r1`]: changes('fix the edge case'),
    [`revise:${S} r2`]: green(`revise:${S} r2`),
    [`review:${S} r2`]: approve,
  })
  clean(r)
  assert.deepEqual(r.calls.map((c) => [c.label, c.model, c.effort]), [
    [`plan:${S}`, 'opus', 'high'], // rung 0's effort
    [`plan-judge:${S} r1`, 'opus', 'medium'], // rung 0's judge
    [`plan-revise:${S} r2`, 'opus', 'xhigh'], // the plan stage climbed to rung 1
    [`plan-judge:${S} r2`, 'opus', 'high'], // rung 1's judge
    [`plan-revise:${S} r3`, 'opus', 'xhigh'], // a second changes does not climb again
    [`plan-judge:${S} r3`, 'opus', 'high'],
    [`implement:${S}`, 'opus', 'xhigh'], // rung 1's effort
    [`implement:${S}@fable-high`, 'fable', 'high'], // the implement stage climbed to rung 2
    [`review:${S} r1`, 'fable', 'max'], // rung 2's review
    [`revise:${S} r2`, 'fable', 'high'],
    [`review:${S} r2`, 'fable', 'max'],
  ])
  assert.ok(oneShot(callOf(r, `implement:${S}`).prompt), 'the first implement pass on the middle rung is still one-shot')
  const retry = callOf(r, `implement:${S}@fable-high`).prompt
  assert.ok(retry.includes('Max iterations: 3') && retry.includes('ONE RUNG UP'), 'the retry runs the full loop as a takeover')
  assert.deepEqual(r.row.climbs, [
    { stage: 'plan', from: 'opus-high', to: 'opus-xhigh' },
    { stage: 'implement', from: 'opus-xhigh', to: 'fable-high' },
    { stage: 'review', from: 'fable-high', to: 'fable-high' },
  ])
  assert.deepEqual([r.row.startRung, r.row.rung, r.row.status, r.row.planRoundsUsed], ['opus-high', 'fable-high', 'review', 3])
  assert.equal(r.logs.filter((l) => l.startsWith('climb:')).length, 3, r.logs.join('\n'))
  assert.ok(r.logs.includes(`climb: ${S} stays on the top rung fable-high (review, a recorded no-op)`), r.logs.join('\n'))
  assert.ok(r.logs.includes(`ladder: ${ladder.source} — opus-high, opus-xhigh, fable-high`), r.logs.join('\n'))
})

// ---- a top-rung start --------------------------------------------------------------------------------

test('top start: the full loop from the first pass, a recorded no-op climb, a same-rung retry at CAPPED_RETRY_ITERATIONS', async (t) => {
  const ladder = ladderFrom(t, null)
  const { CAPPED_RETRY_ITERATIONS } = loadEngine(['CAPPED_RETRY_ITERATIONS'])
  assert.equal(CAPPED_RETRY_ITERATIONS, 2)
  for (const n of [4, 1]) {
    const S = `proj-top${n}`
    const r = await run(mkArgs(mkTask(S, { rung: 'opus-xhigh', maxIterations: n }), { ladder }), {
      [`implement:${S}`]: ralphBlocked,
      [`implement:${S}@opus-xhigh`]: green(`implement:${S}@opus-xhigh`),
      [`review:${S} r1`]: approve,
    })
    clean(r)
    const first = callOf(r, `implement:${S}`).prompt
    assert.ok(first.includes(`Max iterations: ${n}`) && !first.includes('EXACTLY ONCE'), `n=${n}: the top rung's first pass runs the full loop`)
    const retry = callOf(r, `implement:${S}@opus-xhigh`).prompt
    assert.ok(retry.includes('Max iterations: 2'), `n=${n}: the same-rung retry gets CAPPED_RETRY_ITERATIONS`)
    assert.ok(retry.includes('SECOND PASS') && retry.includes("the ladder's top rung") && !retry.includes('ONE RUNG UP'), `n=${n}: no takeover is promised`)
    assert.deepEqual(me(r, `implement:${S}@opus-xhigh`), ['opus', 'xhigh'])
    assert.deepEqual([r.row.startRung, r.row.rung, r.row.climbs], ['opus-xhigh', 'opus-xhigh', [{ stage: 'implement', from: 'opus-xhigh', to: 'opus-xhigh' }]])
  }
})

test('top start: the planner and the investigator each get one same-rung retry', async (t) => {
  const ladder = ladderFrom(t, null)
  const P = 'proj-topplan'
  const p = await run(mkArgs(mkTask(P, { rung: 'opus-xhigh', scope: 'cross-cutting', planGate: true }), { ladder }), {
    [`plan:${P}`]: noPlan,
    [`plan:${P}@opus-xhigh`]: plan,
    [`plan-judge:${P} r1`]: approve,
    [`implement:${P}`]: green(`implement:${P}`),
    [`review:${P} r1`]: approve,
  })
  clean(p)
  const retry = callOf(p, `plan:${P}@opus-xhigh`).prompt
  assert.ok(retry.includes('SECOND PASS') && retry.includes('first planner produced no plan') && !retry.includes('ONE RUNG UP'))
  assert.deepEqual(p.row.climbs, [{ stage: 'plan', from: 'opus-xhigh', to: 'opus-xhigh' }])
  const R = 'proj-topro'
  const ro = await run(mkArgs(mkTask(R, { rung: 'opus-xhigh', scope: 'read-only', maxIterations: 1 }), { ladder }), {
    [`investigate:${R}`]: { ...ralphBlocked, worktreePath: '' },
    [`investigate:${R}@opus-xhigh`]: { ...green(`investigate:${R}@opus-xhigh`), prUrl: '', branch: '' },
  })
  clean(ro)
  const second = callOf(ro, `investigate:${R}@opus-xhigh`).prompt
  assert.ok(second.includes('SECOND PASS') && second.includes('read-only contract above still holds') && !second.includes('FULL verification loop'))
  assert.deepEqual([ro.row.status, ro.row.climbs], ['review', [{ stage: 'implement', from: 'opus-xhigh', to: 'opus-xhigh' }]])
})

test('one rung: the bottom is the top, so every pass runs the full loop and every climb is a recorded no-op', async (t) => {
  const ladder = ladderFrom(t, ONE)
  const S = 'proj-solo'
  const r = await run(mkArgs(mkTask(S, { scope: 'cross-cutting', planGate: true }), { ladder }), {
    [`plan:${S}`]: plan,
    [`plan-judge:${S} r1`]: changes('x'),
    [`plan-revise:${S} r2`]: plan,
    [`plan-judge:${S} r2`]: approve,
    [`implement:${S}`]: ralphBlocked,
    [`implement:${S}@solo`]: green(`implement:${S}@solo`),
    [`review:${S} r1`]: changes('y'),
    [`revise:${S} r2`]: green(`revise:${S} r2`),
    [`review:${S} r2`]: approve,
  })
  clean(r)
  assert.ok(r.calls.every((c) => c.model === 'opus' && !c.prompt.includes('EXACTLY ONCE')), 'no one-shot anywhere')
  assert.ok(callOf(r, `implement:${S}@solo`).prompt.includes('Max iterations: 2'))
  assert.deepEqual(r.row.climbs, ['plan', 'implement', 'review'].map((stage) => ({ stage, from: 'solo', to: 'solo' })))
  assert.deepEqual([r.row.startRung, r.row.rung], ['solo', 'solo'])
})

// ---- compat across the release -----------------------------------------------------------------------

test('compat: pre-3.0.0 args (no ladder, a tier ceiling, a judge pin, model fable, effort max) run on the built-in top rung', async () => {
  const S = 'proj-old'
  const old = mkArgs(mkTask(S, { scope: 'cross-cutting', planGate: true, model: 'fable', effort: 'max' }), { maxTier: 'opus', judgeModel: 'fable' })
  const r = await run(old, {
    [`plan:${S}`]: plan, [`plan-judge:${S} r1`]: approve, [`implement:${S}`]: green(`implement:${S}`), [`review:${S} r1`]: approve,
  })
  clean(r)
  assert.deepEqual(r.calls.map((c) => [c.label, c.model, c.effort]), [
    [`plan:${S}`, 'opus', 'xhigh'], [`plan-judge:${S} r1`, 'opus', 'high'], [`implement:${S}`, 'opus', 'xhigh'], [`review:${S} r1`, 'opus', 'xhigh'],
  ])
  assert.ok(r.calls.every((c) => c.model !== 'fable' && c.effort !== 'max'), 'nothing runs on fable or at max')
  assert.ok(!callOf(r, `implement:${S}`).prompt.includes('EXACTLY ONCE'), 'the top rung runs the full loop')
  assert.deepEqual([r.row.startRung, r.row.rung, r.row.rungDrift], ['opus-xhigh', 'opus-xhigh', ''])
  const line = r.logs.find((l) => l.startsWith('ladder: '))
  assert.ok(line && line.startsWith('ladder: built-in — opus-high, opus-xhigh') && /no args\.ladder/.test(line), line)
  assert.ok(!r.logs.some((l) => /maxTier|judgeModel/.test(l)), 'the retired args leave no trace')
})

test('compat: the legacy mapping picks the starting rung; rung: wins; an empty rung: is absent', (t) => {
  const E = loadEngine(['startRung', 'BUILT_IN_LADDER'])
  const three = ladderFrom(t, THREE)
  for (const L of [E.BUILT_IN_LADDER, three]) {
    const top = L.rungs.length - 1
    const at = (task) => J(E.startRung(task, L))
    for (const task of [{}, { effort: 'low' }, { effort: 'medium' }, { effort: 'high' }, { effort: ' High ' }, { model: 'opus' }, { model: 'sonnet' }, { model: 'opus', effort: 'high' }]) {
      assert.deepEqual(at(task), { index: 0, drift: '' }, JSON.stringify(task))
    }
    for (const task of [{ effort: 'xhigh' }, { effort: 'max' }, { effort: ' MAX ' }, { model: 'fable' }, { model: ' Fable ' }, { model: 'opus', effort: 'max' }, { model: 'fable', effort: 'low' }]) {
      assert.deepEqual(at(task), { index: top, drift: '' }, JSON.stringify(task))
    }
    assert.deepEqual(at({ rung: 'opus-high', model: 'fable', effort: 'max' }), { index: 0, drift: '' }, 'rung: wins over the legacy fields')
    assert.deepEqual(at({ rung: 'opus-xhigh', effort: 'low' }), { index: 1, drift: '' })
    assert.deepEqual(at({ rung: '', model: 'fable' }), { index: top, drift: '' }, 'an empty rung: counts as absent')
    assert.deepEqual(at({ rung: null, effort: 'high' }), { index: 0, drift: '' })
    assert.deepEqual(at({ rung: 'gone' }), { index: top, drift: 'gone' })
    assert.deepEqual(at({ rung: 'constructor' }), { index: top, drift: 'constructor' }, 'a prototype key is drift, never a rung')
    assert.deepEqual(at({ rung: 5, model: 'opus' }), { index: top, drift: '5' }, 'a non-string rung is drift')
  }
})

test('compat: a rung: the ladder lacks reads as the top rung and is reported as drift', async (t) => {
  const ladder = ladderFrom(t, null)
  const S = 'proj-drift'
  const r = await run(mkArgs(mkTask(S, { rung: 'gone' }), { ladder }), { [`implement:${S}`]: green(`implement:${S}`), [`review:${S} r1`]: approve })
  clean(r)
  assert.deepEqual([r.row.startRung, r.row.rung, r.row.rungDrift], ['opus-xhigh', 'opus-xhigh', 'gone'])
  assert.ok(r.logs.includes(`rung drift: ${S}'s rung: gone is not on the ladder (built-in) — read as the top rung opus-xhigh`), r.logs.join('\n'))
})

// ---- malformed args.ladder ------------------------------------------------------------------------------

const H = (c) => c.repeat(40)
const SLUG = 'proj-fix-a'
const PR = 'https://github.com/o/r/pull/7'
const mkI = (over = {}) => ({
  prUrl: PR, branch: 'audit-fix/fix-a', worktreePath: `/repo/.claude/worktrees/${SLUG}`, headSha: H('a'), taskBase: H('b'), mainSha: H('c'),
  trouble: ['conflict'], landed: [], plan: '', reviewHistory: [], reviewRoundsUsed: 1, rung: { startRung: '', rung: '', climbs: [] }, ...over,
})
const integrateArgs = (I, over = {}) => mkArgs(mkTask(SLUG, { scope: 'cross-cutting' }), { mode: 'integrate', integration: I, ...over })

test('a malformed args.ladder is refused before any dispatch, in both modes', async () => {
  const R = (over = {}) => ({ name: 'opus-high', model: 'opus', effort: 'high', judge: 'high', review: 'xhigh', ...over })
  const bad = [
    ['an empty object', {}], ['a string', 'built-in'], ['an array', [R()]], ['no source', { rungs: [R()] }],
    ['an empty source', { source: '', rungs: [R()] }], ['no rungs', { source: 'built-in', rungs: [] }],
    ['rungs not an array', { source: 'x', rungs: R() }], ['a rung not an object', { source: 'x', rungs: ['opus-high'] }],
    ['an unknown model', { source: 'x', rungs: [R({ model: 'haiku' })] }], ['a versioned model', { source: 'x', rungs: [R({ model: 'opus-5.5' })] }],
    ['a bad effort', { source: 'x', rungs: [R({ effort: 'ultra' })] }], ['a bad judge', { source: 'x', rungs: [R({ judge: 'HIGH' })] }],
    ['a missing review', { source: 'x', rungs: [R({ review: undefined })] }],
    ['a duplicate name', { source: 'x', rungs: [R(), R({ effort: 'xhigh' })] }], ['a YAML word', { source: 'x', rungs: [R({ name: 'yes' })] }],
    ['an uppercase name', { source: 'x', rungs: [R({ name: 'Opus' })] }], ['a prototype-key model', { source: 'x', rungs: [R({ model: 'constructor' })] }],
  ]
  for (const [what, ladder] of bad) {
    for (const args of [mkArgs(mkTask('proj-bad'), { ladder }), integrateArgs(mkI(), { ladder })]) {
      const r = await run(args, {})
      assert.match(String(r.error && r.error.message), /^args\.ladder: /, `${args.mode || 'task'}: ${what}`)
      assert.equal(r.calls.length, 0, what)
    }
  }
  const E = loadEngine(['ladderArgsError', 'BUILT_IN_LADDER'])
  assert.equal(E.ladderArgsError(undefined), '')
  assert.equal(E.ladderArgsError(null), '')
  assert.equal(E.ladderArgsError(E.BUILT_IN_LADDER), '')
})

// ---- Integration runs on the top rung -------------------------------------------------------------------

// A merged integration with a conflict: the integrator, then the judge.
const merged = {
  blocked: false, blockerDiagnosis: '', verified: true, mergeState: 'merged', mergeCommit: H('d'), taskHead: H('a'), baseSha: H('c'),
  headSha: H('d'), pushedSha: H('d'), conflictFiles: ['a.js'], fixCommits: [], summary: 's', finishedAt: '2026-10-03T10:20:00Z',
  mergeLog: [`anchor: ${H('a')} base ${H('b')}`, `task head: ${H('a')}`, `integration base: ${H('c')}`, 'task file: a.js', 'merge: conflict', 'conflict: a.js'].join('\n'),
}
const integrateScript = {
  [`integrate:${SLUG}`]: merged,
  [`integration-review:${SLUG} r2`]: { verdict: 'approve', feedback: [], unreadable: false, finishedAt: '2026-10-03T10:30:00Z' },
}

test('integrate: the integrator and the judge run on the top rung — its effort and its review effort', async (t) => {
  const three = ladderFrom(t, THREE)
  const climbed = { startRung: 'opus-high', rung: 'opus-xhigh', climbs: [{ stage: 'implement', from: 'opus-high', to: 'opus-xhigh' }] }
  const r = await run(integrateArgs(mkI({ rung: climbed }), { ladder: three }), integrateScript)
  clean(r)
  assert.deepEqual(r.calls.map((c) => [c.label, c.model, c.effort, c.phase]), [
    [`integrate:${SLUG}`, 'fable', 'high', 'Integration'], [`integration-review:${SLUG} r2`, 'fable', 'max', 'Integration'],
  ])
  assert.deepEqual(r.row.integration.agents.map((g) => [g.role, g.rung, g.model, g.effort]), [['integrator', 'fable-high', 'fable', 'high'], ['judge', 'fable-high', 'fable', 'max']])
  assert.deepEqual([r.row.startRung, r.row.rung, r.row.climbs, r.row.rungDrift], [climbed.startRung, climbed.rung, climbed.climbs, ''], "the task's own record passes through")
  assert.deepEqual(r.row.ran, [
    { label: `integrate:${SLUG}`, rung: 'fable-high', model: 'fable', effort: 'high' },
    { label: `integration-review:${SLUG} r2`, rung: 'fable-high', model: 'fable', effort: 'max' },
  ])
  assert.ok(r.logs.includes(`ladder: ${three.source} — opus-high, opus-xhigh, fable-high`), r.logs.join('\n'))
  const builtIn = await run(integrateArgs(mkI()), integrateScript)
  clean(builtIn)
  assert.deepEqual(builtIn.calls.map((c) => [c.model, c.effort]), [['opus', 'xhigh'], ['opus', 'xhigh']], 'no args.ladder: the built-in top rung, xhigh both')
})

test('integrate: a neutral record and a legacy tier record both pass and give a neutral row; anything else is refused', async () => {
  const neutral = { startRung: '', rung: '', climbs: [] }
  for (const rung of [neutral, { startRung: '', rung: 'opus-xhigh', climbs: [] },
    { model: 'fable', escalated: true, escalatedAt: 'review', tierCapped: false, tierCappedAt: '' },
    { model: 'opus', escalated: false, escalatedAt: '', tierCapped: true, tierCappedAt: 'plan' }]) {
    const r = await run(integrateArgs(mkI({ rung })), integrateScript)
    clean(r)
    const want = 'model' in rung ? neutral : rung
    assert.deepEqual([r.row.startRung, r.row.rung, r.row.climbs, r.row.rungDrift], [want.startRung, want.rung, want.climbs, ''], JSON.stringify(rung))
    assert.ok(!('model' in r.row) && !('tierCapped' in r.row) && !('escalated' in r.row))
  }
  const bad = [
    'opus-xhigh', null, undefined, [], {}, { startRung: '', rung: '' }, { startRung: '', rung: 'Opus', climbs: [] },
    { startRung: 'yes', rung: '', climbs: [] }, { startRung: '', rung: '', climbs: [{ stage: 'merge', from: 'a', to: 'b' }] },
    { startRung: '', rung: '', climbs: [{ stage: 'plan', from: 'a' }] }, { startRung: '', rung: '', climbs: 'plan' },
    { startRung: '', rung: '', climbs: [], rungDrift: '' },
    { model: 'haiku', escalated: false, escalatedAt: '', tierCapped: false, tierCappedAt: '' },
    { model: 'fable', escalated: false, escalatedAt: '', tierCapped: 'review', tierCappedAt: 'review' },
  ]
  for (const rung of bad) {
    const r = await run(integrateArgs(mkI({ rung })), integrateScript)
    assert.match(String(r.error && r.error.message), /^args\.integration: rung /, JSON.stringify(rung))
    assert.equal(r.calls.length, 0)
  }
})

// ---- rows when nothing ran normally ----------------------------------------------------------------------

test('a stage that throws after a climb still reports its climbs and what ran', async (t) => {
  const ladder = ladderFrom(t, null)
  const S = 'proj-throw'
  const r = await run(mkArgs(mkTask(S), { ladder }), {
    [`implement:${S}`]: redOneShot,
    [`implement:${S}@opus-xhigh`]: new Error('scripted stage failure'),
  })
  assert.equal(r.error, undefined)
  assert.deepEqual([r.row.status, r.row.blockerDiagnosis], ['blocked', THREW])
  assert.deepEqual([r.row.startRung, r.row.rung], ['opus-high', 'opus-xhigh'])
  assert.deepEqual(r.row.climbs, [{ stage: 'implement', from: 'opus-high', to: 'opus-xhigh' }])
  assert.deepEqual(r.row.ran.map((x) => [x.label, x.rung]), [[`implement:${S}`, 'opus-high'], [`implement:${S}@opus-xhigh`, 'opus-xhigh']])
})

test('a pre-flight budget block reports its starting rung, no climbs and nothing ran', async (t) => {
  const ladder = ladderFrom(t, THREE)
  const r = await run(mkArgs(mkTask('proj-budget', { rung: 'opus-xhigh', maxReviewRounds: 0 }), { ladder }), {})
  clean(r)
  assert.equal(r.calls.length, 0)
  assert.deepEqual([r.row.status, r.row.startRung, r.row.rung, r.row.climbs, r.row.ran, r.row.rungDrift], ['review-blocked', 'opus-xhigh', 'opus-xhigh', [], [], ''])
})

// ---- static ---------------------------------------------------------------------------------------------

test('static: the tier vocabulary is gone from skills/execute but for SKILL.md\'s one max_tier warning', () => {
  const dir = path.join(root, 'skills', 'execute')
  const hits = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (e.name !== '__pycache__') walk(p); continue }
      fs.readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
        if (/maxTier|max_tier|TOP_TIER/.test(l)) hits.push(`${path.relative(root, p)}:${i + 1}`)
      })
    }
  }
  walk(dir)
  assert.equal(hits.length, 1, hits.join('\n'))
  assert.match(hits[0], /^skills\/execute\/SKILL\.md:\d+$/)
  const line = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8').split('\n')[Number(hits[0].split(':')[1]) - 1]
  assert.ok(line.includes("`max_tier:` ignored; the ceiling is the ladder's top rung"), line)
  const src = fs.readFileSync(enginePath, 'utf8')
  for (const word of [/judgeModel/, /TIER_RANK/, /\bEFFORT\b/, /\bst\.tier\b/, /INTEGRATION_EFFORT/, /\btierCap\(/]) {
    assert.ok(!word.test(src), `the engine has no ${word}`)
  }
})
