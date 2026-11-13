// p13-2 (ADR 0029 decisions 3 to 7): the engine climbs the operator's ladder.
//
// The ladder arrives in each Workflow call's args (`args.ladder`, ladder.py's JSON, resolved by the lead at the
// call's start); with none, the built-in ladder applies. A task starts on its `rung:` (default the bottom rung;
// a name the ladder lacks reads as the top rung and is reported as drift). Each stage (plan, implement, review)
// climbs one rung at its first evidence of hardness, once per call, never past the top; on the top rung a climb
// is a recorded no-op. Below the top a stage's first pass verifies one-shot; the retry after a real climb and
// every pass on the top rung run the full Ralph loop, and a top-rung retry keeps CAPPED_RETRY_ITERATIONS. Judges
// run on the current rung. Integration runs on the highest rung that is not all-Fable (ADR 0079 decision 2). A rung
// may name a plan model and the ladder a role's own model (ADR 0079 decisions 1 and 3). The row records startRung,
// rung, climbs, rungDrift and what each dispatch ran.
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
import { runTask, loadEngine, enginePath, VERIFY_SLOT } from './lib/engine.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LADDER_PY = path.join(root, 'skills', '_shared', 'scripts', 'ladder.py')
const J = (x) => JSON.parse(JSON.stringify(x))
const THREW = 'workflow stage threw — see /workflows'
const PLAN_TEXT = 'Planned on: abc\n### Files to modify\n- x\n### Gated inputs\nNone'

// ---- ladders: ladder.py's own output ------------------------------------------------------------------

function rungToml(r) {
  return `[[rung]]\nname = "${r.name}"\nmodel = "${r.model}"\neffort = "${r.effort}"\njudge = "${r.judge}"\nreview = "${r.review}"\n` +
    (r.plan !== undefined ? `plan = "${r.plan}"\n` : '')
}
// ladder.py run under a temp HOME holding `rungs` as its ladder.toml (none: no file, the built-in ladder), and
// `roles` (ADR 0079 decision 3) as its [role] table when given.
function ladderFrom(t, rungs, roles) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-ladder-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  if (rungs) {
    const p = path.join(home, '.config', 'thread', 'ladder.toml')
    fs.mkdirSync(path.dirname(p), { recursive: true })
    const roleToml = roles ? '\n[role]\n' + Object.entries(roles).map(([k, v]) => `${k} = "${v}"\n`).join('') : ''
    fs.writeFileSync(p, rungs.map(rungToml).join('\n') + roleToml)
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
// The built-in ladder's two rungs, written as a file (so a [role] table can join them).
const BUILT_IN_RUNGS = [
  { name: 'opus-high', model: 'opus', effort: 'high', judge: 'high', review: 'xhigh' },
  { name: 'opus-xhigh', model: 'opus', effort: 'xhigh', judge: 'high', review: 'xhigh' },
]

// ---- the run harness ----------------------------------------------------------------------------------

const mkTask = (slug, over = {}) => ({
  slug, taskPath: `/vault/Tasks/${slug}.md`, scope: 'single-file', planGate: false,
  maxIterations: 3, maxReviewRounds: 3, maxPlanRounds: 3, ...over,
})
// args.verifySlot is required (estate ADR 0009 d4): every call carries one.
const mkArgs = (task, over = {}) => ({
  rolloutSlug: 'proj-rollout-2026-10-03', repoPath: '/repo', verifier: 'make test', date: '2026-10-03',
  verifySlot: VERIFY_SLOT, task, ...over,
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
// The planner and the read-only investigator work in the task tree with no source edits, no commits and no PR.
// Their retry framing (a same-rung second pass, or a takeover one rung up) must never hand them the
// code-writing roles' verification loop or a branch with committed work on it.
const READ_ONLY_CONTRACT = 'no source edits, no commits, no PR'
function assertNoCodeFraming(p, what) {
  assert.ok(!p.includes('FULL verification loop'), `${what}: no FULL verification loop`)
  assert.ok(!p.includes('on your branch'), `${what}: no committed work on a branch`)
  assert.ok(p.includes(READ_ONLY_CONTRACT), `${what}: keeps the "${READ_ONLY_CONTRACT}" contract`)
}

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
  assertNoCodeFraming(retry, 'the top-rung planner retry')
  assert.ok(retry.includes('SECOND PASS: a first attempt at this plan') && retry.includes('plan-only contract above still holds'), 'the planner second pass asks for a plan')
  assert.deepEqual(p.row.climbs, [{ stage: 'plan', from: 'opus-xhigh', to: 'opus-xhigh' }])
  const R = 'proj-topro'
  const ro = await run(mkArgs(mkTask(R, { rung: 'opus-xhigh', scope: 'read-only', maxIterations: 1 }), { ladder }), {
    [`investigate:${R}`]: { ...ralphBlocked, worktreePath: '' },
    [`investigate:${R}@opus-xhigh`]: { ...green(`investigate:${R}@opus-xhigh`), prUrl: '', branch: '' },
  })
  clean(ro)
  const second = callOf(ro, `investigate:${R}@opus-xhigh`).prompt
  assert.ok(second.includes('SECOND PASS') && second.includes('read-only contract above still holds') && !second.includes('FULL verification loop'))
  assertNoCodeFraming(second, 'the top-rung investigator retry')
  assert.deepEqual([ro.row.status, ro.row.climbs], ['review', [{ stage: 'implement', from: 'opus-xhigh', to: 'opus-xhigh' }]])
})

test('bottom start: the planner and the investigator climb one rung and take over with no branch or verification wording', async (t) => {
  const ladder = ladderFrom(t, null)
  const P = 'proj-upplan'
  const p = await run(mkArgs(mkTask(P, { scope: 'cross-cutting', planGate: true }), { ladder }), {
    [`plan:${P}`]: noPlan,
    [`plan:${P}@opus-xhigh`]: plan,
    [`plan-judge:${P} r1`]: approve,
    [`implement:${P}`]: green(`implement:${P}`),
    [`review:${P} r1`]: approve,
  })
  clean(p)
  assert.deepEqual(me(p, `plan:${P}`), ['opus', 'high'])
  assert.deepEqual(me(p, `plan:${P}@opus-xhigh`), ['opus', 'xhigh'], 'the planner retry runs one rung up')
  const takeover = callOf(p, `plan:${P}@opus-xhigh`).prompt
  assert.ok(takeover.includes('ESCALATION: you take this plan over ONE RUNG UP') && !takeover.includes('SECOND PASS'), 'a real plan climb is a planner takeover')
  assert.ok(takeover.includes('first planner produced no plan') && takeover.includes('plan-only contract above still holds'))
  assertNoCodeFraming(takeover, 'the planner takeover after a real plan climb')
  assert.deepEqual(p.row.climbs, [{ stage: 'plan', from: 'opus-high', to: 'opus-xhigh' }])

  const R = 'proj-upro'
  const ro = await run(mkArgs(mkTask(R, { scope: 'read-only' }), { ladder }), {
    [`investigate:${R}`]: { ...ralphBlocked, prUrl: '', branch: '', blockerDiagnosis: 'could not reach the logs' },
    [`investigate:${R}@opus-xhigh`]: { ...green(`investigate:${R}@opus-xhigh`), prUrl: '', branch: '' },
  })
  clean(ro)
  assert.deepEqual(ro.calls.map((c) => [c.label, c.model, c.effort]), [[`investigate:${R}`, 'opus', 'high'], [`investigate:${R}@opus-xhigh`, 'opus', 'xhigh']], 'the investigator retry runs one rung up')
  const up = callOf(ro, `investigate:${R}@opus-xhigh`).prompt
  assert.ok(up.includes('ESCALATION: you take this investigation over ONE RUNG UP') && !up.includes('SECOND PASS'), 'a real climb is an investigator takeover')
  assert.ok(up.includes('could not reach the logs') && up.includes('read-only contract above still holds'))
  assert.ok(up.includes('READ-ONLY task (scope: read-only)'), 'the read-only prompt itself, not the implementer\'s')
  assertNoCodeFraming(up, 'the investigator takeover after a real bottom-to-top climb')
  assert.deepEqual([ro.row.status, ro.row.startRung, ro.row.rung, ro.row.climbs], ['review', 'opus-high', 'opus-xhigh', [{ stage: 'implement', from: 'opus-high', to: 'opus-xhigh' }]])
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
  trouble: ['conflict'], landed: [], reviewHistory: [], reviewRoundsUsed: 1, rung: { startRung: '', rung: '', climbs: [] }, ...over,
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
    ['an unknown plan model', { source: 'x', rungs: [R({ plan: 'haiku' })] }], ['a null plan model', { source: 'x', rungs: [R({ plan: null })] }],
    ['roles as an array', { source: 'x', rungs: [R()], roles: [['builder', 'fable']] }], ['roles as a string', { source: 'x', rungs: [R()], roles: 'fable' }],
    ['roles null', { source: 'x', rungs: [R()], roles: null }],
    ['an unknown role: lead', { source: 'x', rungs: [R()], roles: { lead: 'fable' } }],
    ['a prototype-key role', { source: 'x', rungs: [R()], roles: { constructor: 'fable' } }],
    ['a role on an unknown model', { source: 'x', rungs: [R()], roles: { builder: 'gpt' } }],
  ]
  for (const [what, ladder] of bad) {
    for (const args of [mkArgs(mkTask('proj-bad'), { ladder }), integrateArgs(mkI(), { ladder })]) {
      const r = await run(args, {})
      assert.match(String(r.error && r.error.message), /^thread:args-refused: args\.ladder: /, `${args.mode || 'task'}: ${what}`)
      assert.equal(r.calls.length, 0, what)
    }
  }
  const E = loadEngine(['ladderArgsError', 'BUILT_IN_LADDER'])
  assert.equal(E.ladderArgsError(undefined), '')
  assert.equal(E.ladderArgsError(null), '')
  assert.equal(E.ladderArgsError(E.BUILT_IN_LADDER), '')
  assert.equal(E.ladderArgsError({ source: 'x', rungs: [R({ plan: 'fable' })], roles: { 'master-review': 'fable', builder: 'opus', investigator: 'fable' } }), '')
  assert.equal(E.ladderArgsError({ source: 'x', rungs: [R()], roles: {} }), '', 'an empty roles object names no role')
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

test('integrate: the integrator and the judge run on the highest rung below an all-Fable top — its effort and its review effort', async (t) => {
  const three = ladderFrom(t, THREE)
  const climbed = { startRung: 'opus-high', rung: 'fable-high', climbs: [{ stage: 'implement', from: 'opus-high', to: 'opus-xhigh' }, { stage: 'review', from: 'opus-xhigh', to: 'fable-high' }] }
  const r = await run(integrateArgs(mkI({ rung: climbed }), { ladder: three }), integrateScript)
  clean(r)
  assert.deepEqual(r.calls.map((c) => [c.label, c.model, c.effort, c.phase]), [
    [`integrate:${SLUG}`, 'opus', 'xhigh', 'Integration'], [`integration-review:${SLUG} r2`, 'opus', 'xhigh', 'Integration'],
  ])
  assert.deepEqual(r.row.integration.agents.map((g) => [g.role, g.rung, g.model, g.effort]), [['integrator', 'opus-xhigh', 'opus', 'xhigh'], ['judge', 'opus-xhigh', 'opus', 'xhigh']])
  assert.deepEqual([r.row.startRung, r.row.rung, r.row.climbs, r.row.rungDrift], [climbed.startRung, climbed.rung, climbed.climbs, ''], "the task's own record passes through")
  assert.deepEqual(r.row.ran, [
    { label: `integrate:${SLUG}`, rung: 'opus-xhigh', model: 'opus', effort: 'xhigh' },
    { label: `integration-review:${SLUG} r2`, rung: 'opus-xhigh', model: 'opus', effort: 'xhigh' },
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
    assert.match(String(r.error && r.error.message), /^thread:args-refused: args\.integration: rung /, JSON.stringify(rung))
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

// ---- the plan model and role models (ADR 0079 decisions 1 to 4) --------------------------------------------

// Two Opus rungs that plan on Fable, then an all-Fable rung.
const P3 = [
  { name: 'opus-high', model: 'opus', effort: 'high', judge: 'medium', review: 'high', plan: 'fable' },
  { name: 'opus-xhigh', model: 'opus', effort: 'xhigh', judge: 'high', review: 'xhigh', plan: 'fable' },
  { name: 'fable-high', model: 'fable', effort: 'high', judge: 'high', review: 'high' },
]
const rowRan = (r) => r.row.ran.map((x) => ({ label: x.label, model: x.model, effort: x.effort }))
const triples = (r) => r.calls.map((c) => [c.label, c.model, c.effort])

test('plan model: the planner, plan reviser and plan judge run on it at high; implement runs on the rung', async (t) => {
  const ladder = ladderFrom(t, P3)
  assert.deepEqual(ladder.rungs.map((g) => g.plan), ['fable', 'fable', undefined])
  const S = 'proj-plan'
  const gated = (slug) => mkTask(slug, { scope: 'cross-cutting', planGate: true })
  const c = await run(mkArgs(gated(S), { ladder }), {
    [`plan:${S}`]: plan, [`plan-judge:${S} r1`]: approve, [`implement:${S}`]: green(`implement:${S}`), [`review:${S} r1`]: approve,
  })
  clean(c)
  assert.deepEqual(triples(c), [
    [`plan:${S}`, 'fable', 'high'], [`plan-judge:${S} r1`, 'fable', 'high'], [`implement:${S}`, 'opus', 'high'], [`review:${S} r1`, 'opus', 'high'],
  ])
  assert.deepEqual(rowRan(c), ranOf(c))
  const F = 'proj-planfight'
  const r = await run(mkArgs(gated(F), { ladder }), {
    [`plan:${F}`]: plan,
    [`plan-judge:${F} r1`]: changes('tighten it'),
    [`plan-revise:${F} r2`]: plan,
    [`plan-judge:${F} r2`]: approve,
    [`implement:${F}`]: green(`implement:${F}`),
    [`review:${F} r1`]: approve,
  })
  clean(r)
  assert.deepEqual(triples(r), [
    [`plan:${F}`, 'fable', 'high'],
    [`plan-judge:${F} r1`, 'fable', 'high'],
    [`plan-revise:${F} r2`, 'fable', 'high'], // the climb moved the rung, not the plan model
    [`plan-judge:${F} r2`, 'fable', 'high'],
    [`implement:${F}`, 'opus', 'xhigh'], // implement starts on the rung the plan stage reached
    [`review:${F} r1`, 'opus', 'xhigh'],
  ])
  assert.deepEqual(r.row.climbs, [{ stage: 'plan', from: 'opus-high', to: 'opus-xhigh' }])
  assert.deepEqual([r.row.startRung, r.row.rung], ['opus-high', 'opus-xhigh'])
  assert.deepEqual(r.row.ran.map((x) => x.rung), ['opus-high', 'opus-high', 'opus-xhigh', 'opus-xhigh', 'opus-xhigh', 'opus-xhigh'])
  assert.deepEqual(rowRan(r), ranOf(r))
})

// The planner's retry framing reads its dispatch on both rungs (planHeld): the same model and effort is a second pass.
const HELD = "runs on the same model and effort on this rung as on the one below"
test('plan model: a planner retry after a climb that kept the planner\'s model and effort is a second pass, not a takeover', async (t) => {
  const ladder = ladderFrom(t, P3)
  const S = 'proj-planretry'
  const r = await run(mkArgs(mkTask(S, { scope: 'cross-cutting', planGate: true }), { ladder }), {
    [`plan:${S}`]: noPlan,
    [`plan:${S}@opus-xhigh`]: plan,
    [`plan-judge:${S} r1`]: approve,
    [`implement:${S}`]: green(`implement:${S}`),
    [`review:${S} r1`]: approve,
  })
  clean(r)
  assert.deepEqual(me(r, `plan:${S}@opus-xhigh`), ['fable', 'high'])
  const retry = callOf(r, `plan:${S}@opus-xhigh`).prompt
  assert.ok(retry.includes("SECOND PASS: a first attempt at this plan did not complete") && retry.includes(HELD), retry.slice(-800))
  assert.ok(!retry.includes('ONE RUNG UP') && !retry.includes("ladder's top rung"), 'neither a takeover nor a top-rung claim')
  assert.ok(retry.includes('first planner produced no plan'))
  assertNoCodeFraming(retry, 'the plan-model planner retry')
  assert.deepEqual(r.row.climbs, [{ stage: 'plan', from: 'opus-high', to: 'opus-xhigh' }])
  // A climb into a rung that names no plan model changes the planner: a takeover one rung up, as before.
  const bottomOnly = ladderFrom(t, [P3[0], { ...P3[1], plan: undefined }])
  const B = 'proj-planup'
  const u = await run(mkArgs(mkTask(B, { scope: 'cross-cutting', planGate: true }), { ladder: bottomOnly }), {
    [`plan:${B}`]: noPlan, [`plan:${B}@opus-xhigh`]: plan, [`plan-judge:${B} r1`]: approve, [`implement:${B}`]: green(`implement:${B}`), [`review:${B} r1`]: approve,
  })
  clean(u)
  assert.deepEqual(triples(u).slice(0, 3), [[`plan:${B}`, 'fable', 'high'], [`plan:${B}@opus-xhigh`, 'opus', 'xhigh'], [`plan-judge:${B} r1`, 'opus', 'high']])
  const up = callOf(u, `plan:${B}@opus-xhigh`).prompt
  assert.ok(up.includes('ESCALATION: you take this plan over ONE RUNG UP') && !up.includes(HELD))
  // ADR 0079 decision 2's shape: a rung that plans on Fable at high climbs into the all-Fable rung, which names no plan
  // model and plans on its own model at its own effort, fable at high: the planner is unchanged, so a second pass.
  const X = 'proj-planfable'
  const f = await run(mkArgs(mkTask(X, { rung: 'opus-xhigh', scope: 'cross-cutting', planGate: true }), { ladder }), {
    [`plan:${X}`]: noPlan, [`plan:${X}@fable-high`]: plan, [`plan-judge:${X} r1`]: approve, [`implement:${X}`]: green(`implement:${X}`), [`review:${X} r1`]: approve,
  })
  clean(f)
  assert.deepEqual(triples(f).slice(0, 2), [[`plan:${X}`, 'fable', 'high'], [`plan:${X}@fable-high`, 'fable', 'high']])
  assert.deepEqual(f.row.climbs, [{ stage: 'plan', from: 'opus-xhigh', to: 'fable-high' }])
  const held = callOf(f, `plan:${X}@fable-high`).prompt
  assert.ok(held.includes('SECOND PASS: a first attempt at this plan did not complete') && held.includes(HELD), held.slice(-800))
  assert.ok(!held.includes('ONE RUNG UP') && !held.includes("ladder's top rung"), 'neither a takeover nor a top-rung claim')
  assertNoCodeFraming(held, 'the planner retry into the all-Fable rung')
  assert.deepEqual(rowRan(f), ranOf(f))
})

test('role models: each moves its own role only, at high', async (t) => {
  const two = (roles) => ladderFrom(t, BUILT_IN_RUNGS, roles)
  const S = 'proj-rmr'
  const fight = (slug) => ({
    [`implement:${slug}`]: green(`implement:${slug}`), [`review:${slug} r1`]: changes('fix it'),
    [`revise:${slug} r2`]: green(`revise:${slug} r2`), [`review:${slug} r2`]: approve,
  })
  const mr = await run(mkArgs(mkTask(S), { ladder: two({ 'master-review': 'fable' }) }), fight(S))
  clean(mr)
  assert.deepEqual(triples(mr), [
    [`implement:${S}`, 'opus', 'high'], [`review:${S} r1`, 'fable', 'high'], [`revise:${S} r2`, 'opus', 'xhigh'], [`review:${S} r2`, 'fable', 'high'],
  ])
  assert.deepEqual(rowRan(mr), ranOf(mr))
  const B = 'proj-rbuild'
  const b = await run(mkArgs(mkTask(B), { ladder: two({ builder: 'fable' }) }), {
    ...fight(B), [`implement:${B}`]: ralphBlocked, [`implement:${B}@opus-high`]: green(`implement:${B}@opus-high`),
  })
  clean(b)
  assert.deepEqual(triples(b), [
    [`implement:${B}`, 'fable', 'high'], [`implement:${B}@opus-high`, 'fable', 'high'], [`review:${B} r1`, 'opus', 'xhigh'],
    [`revise:${B} r2`, 'fable', 'high'], [`review:${B} r2`, 'opus', 'xhigh'],
  ])
  assert.deepEqual(rowRan(b), ranOf(b))
  // A builder on its own model has no stronger pass (decision 4, p46-2), so a `[role]` model takes the full loop and
  // recorded no-op climbs too, on purpose: the rung stays where it was.
  assert.ok(!oneShot(callOf(b, `implement:${B}`).prompt) && callOf(b, `implement:${B}`).prompt.includes('Max iterations: 3'))
  assert.deepEqual(b.row.climbs, [{ stage: 'implement', from: 'opus-high', to: 'opus-high' }, { stage: 'review', from: 'opus-high', to: 'opus-high' }])
  const I = 'proj-rinv'
  const inv = await run(mkArgs(mkTask(I, { scope: 'read-only' }), { ladder: two({ investigator: 'fable' }) }), {
    [`investigate:${I}`]: { ...green(`investigate:${I}`), prUrl: '', branch: '' },
  })
  clean(inv)
  assert.deepEqual(triples(inv), [[`investigate:${I}`, 'fable', 'high']])
  // A role that names the rung's own model dispatches exactly as with no role.
  const O = 'proj-rown'
  const same = await run(mkArgs(mkTask(O), { ladder: two({ builder: 'opus', 'master-review': 'opus' }) }), fight(O))
  const none = await run(mkArgs(mkTask(O), { ladder: two() }), fight(O))
  clean(same)
  clean(none)
  assert.deepEqual(triples(same), triples(none))
  assert.deepEqual(same.calls.map((c) => c.prompt), none.calls.map((c) => c.prompt))
})

test('role models: on an all-Fable rung the rung wins for every role', async (t) => {
  const ladder = ladderFrom(t, THREE, { builder: 'opus', 'master-review': 'opus' })
  const S = 'proj-allfable'
  const r = await run(mkArgs(mkTask(S, { rung: 'fable-high' }), { ladder }), { [`implement:${S}`]: green(`implement:${S}`), [`review:${S} r1`]: approve })
  clean(r)
  assert.deepEqual(triples(r), [[`implement:${S}`, 'fable', 'high'], [`review:${S} r1`, 'fable', 'max']])
  const below = await run(mkArgs(mkTask(S, { rung: 'opus-xhigh' }), { ladder: ladderFrom(t, THREE, { builder: 'fable' }) }), { [`implement:${S}`]: green(`implement:${S}`), [`review:${S} r1`]: approve })
  clean(below)
  assert.deepEqual(triples(below), [[`implement:${S}`, 'fable', 'high'], [`review:${S} r1`, 'opus', 'xhigh']], 'below it the role wins')
  const E = loadEngine(['allFable'])
  assert.equal(E.allFable({ model: 'fable' }), true)
  assert.equal(E.allFable({ model: 'fable', plan: 'fable' }), true)
  assert.equal(E.allFable({ model: 'fable', plan: 'opus' }), false, 'a fable rung that plans on opus is not all-Fable')
  assert.equal(E.allFable({ model: 'opus', plan: 'fable' }), false)
})

test('a task that fights at two stages climbs to the all-Fable rung', async (t) => {
  const ladder = ladderFrom(t, P3, { builder: 'opus' })
  const S = 'proj-twofights'
  const r = await run(mkArgs(mkTask(S), { ladder }), {
    [`implement:${S}`]: redOneShot,
    [`implement:${S}@opus-xhigh`]: green(`implement:${S}@opus-xhigh`),
    [`review:${S} r1`]: changes('fix the edge case'),
    [`revise:${S} r2`]: green(`revise:${S} r2`),
    [`review:${S} r2`]: approve,
  })
  clean(r)
  assert.deepEqual(triples(r), [
    [`implement:${S}`, 'opus', 'high'], [`implement:${S}@opus-xhigh`, 'opus', 'xhigh'], [`review:${S} r1`, 'opus', 'xhigh'],
    [`revise:${S} r2`, 'fable', 'high'], [`review:${S} r2`, 'fable', 'high'],
  ])
  assert.deepEqual([r.row.status, r.row.startRung, r.row.rung], ['review', 'opus-high', 'fable-high'])
  assert.deepEqual(r.row.climbs, [{ stage: 'implement', from: 'opus-high', to: 'opus-xhigh' }, { stage: 'review', from: 'opus-xhigh', to: 'fable-high' }])
  assert.deepEqual(rowRan(r), ranOf(r))
})

test('integrate: the Integration rung takes no plan or role model; a top that is not all-Fable is the Integration rung', async (t) => {
  const agentsOf = (r) => r.row.integration.agents.map((g) => [g.role, g.rung, g.model, g.effort])
  const p3 = await run(integrateArgs(mkI(), { ladder: ladderFrom(t, P3, { 'master-review': 'fable', builder: 'fable' }) }), integrateScript)
  clean(p3)
  assert.deepEqual(agentsOf(p3), [['integrator', 'opus-xhigh', 'opus', 'xhigh'], ['judge', 'opus-xhigh', 'opus', 'xhigh']], 'its own model, never the plan or a role model')
  const plansOnOpus = [BUILT_IN_RUNGS[0], { name: 'fable-high', model: 'fable', effort: 'high', judge: 'high', review: 'max', plan: 'opus' }]
  const top = await run(integrateArgs(mkI(), { ladder: ladderFrom(t, plansOnOpus) }), integrateScript)
  clean(top)
  assert.deepEqual(agentsOf(top), [['integrator', 'fable-high', 'fable', 'high'], ['judge', 'fable-high', 'fable', 'max']])
  const one = await run(integrateArgs(mkI(), { ladder: ladderFrom(t, [THREE[2]]) }), integrateScript)
  clean(one)
  assert.deepEqual(agentsOf(one), [['integrator', 'fable-high', 'fable', 'high'], ['judge', 'fable-high', 'fable', 'max']], 'one all-Fable rung: nothing is below it')
  const both = await run(integrateArgs(mkI(), { ladder: ladderFrom(t, [{ ...THREE[2], name: 'fable-a' }, THREE[2]]) }), integrateScript)
  clean(both)
  assert.deepEqual(agentsOf(both).map((g) => g[1]), ['fable-high', 'fable-high'], 'every rung all-Fable: the top')
  const roles = await run(integrateArgs(mkI(), { ladder: ladderFrom(t, BUILT_IN_RUNGS, { 'master-review': 'fable' }) }), integrateScript)
  clean(roles)
  assert.deepEqual(roles.calls.map((c) => [c.model, c.effort]), [['opus', 'xhigh'], ['opus', 'xhigh']], 'a master-review role does not move the Integration judge')
})

test('log: the ladder line names plan models and roles only when the file does', async (t) => {
  const ladder = ladderFrom(t, P3, { 'master-review': 'fable', investigator: 'opus' })
  const S = 'proj-log'
  const r = await run(mkArgs(mkTask(S), { ladder }), { [`implement:${S}`]: green(`implement:${S}`), [`review:${S} r1`]: approve })
  clean(r)
  assert.ok(r.logs.includes(`ladder: ${ladder.source} — opus-high (plan fable), opus-xhigh (plan fable), fable-high; roles: master-review fable, investigator opus`), r.logs.join('\n'))
  const plain = ladderFrom(t, BUILT_IN_RUNGS)
  const p = await run(mkArgs(mkTask(S), { ladder: plain }), { [`implement:${S}`]: green(`implement:${S}`), [`review:${S} r1`]: approve })
  assert.ok(p.logs.includes(`ladder: ${plain.source} — opus-high, opus-xhigh`), p.logs.join('\n'))
})

// ---- arms (ADR 0079 decisions 3 and 4, p46-2) -----------------------------------------------------------------
// args.task.arms is the task's stamped arms: an opus or fable arm is the role's own model, `none` takes `roles`, then
// the rung. A role on its own model has no stronger pass, so its climbs are recorded no-ops and its first pass runs
// the full loop. The planner and plan judge never take an arm, and an all-Fable rung wins for every role.

const OWN_TEXT = "its own model, not the rung's, so a climb would not strengthen it"
const fightOf = (slug) => ({
  [`implement:${slug}`]: green(`implement:${slug}`), [`review:${slug} r1`]: changes('fix it'),
  [`revise:${slug} r2`]: green(`revise:${slug} r2`), [`review:${slug} r2`]: approve,
})

test('arms: a master-review fable arm sends every review round to fable at high, and implement stays on the rung', async (t) => {
  const ladder = ladderFrom(t, BUILT_IN_RUNGS)
  const S = 'proj-arm-mr'
  const r = await run(mkArgs(mkTask(S, { arms: { 'master-review': 'fable', builder: 'none' } }), { ladder }), fightOf(S))
  clean(r)
  assert.deepEqual(triples(r), [
    [`implement:${S}`, 'opus', 'high'], [`review:${S} r1`, 'fable', 'high'], [`revise:${S} r2`, 'opus', 'xhigh'], [`review:${S} r2`, 'fable', 'high'],
  ])
  assert.ok(oneShot(callOf(r, `implement:${S}`).prompt), 'a builder in no arm keeps the one-shot below the top')
  assert.deepEqual(r.row.climbs, [{ stage: 'review', from: 'opus-high', to: 'opus-xhigh' }], 'the reviser in no arm still climbs')
  assert.deepEqual(rowRan(r), ranOf(r))
  assert.ok(r.logs.includes('arms: master-review fable, builder none'), r.logs.join('\n'))
})

test('arms: a builder fable arm runs the full loop, records its climbs as no-ops and retries at CAPPED_RETRY_ITERATIONS', async (t) => {
  const ladder = ladderFrom(t, BUILT_IN_RUNGS)
  const S = 'proj-arm-b'
  const r = await run(mkArgs(mkTask(S, { arms: { 'master-review': 'opus', builder: 'fable' } }), { ladder }), {
    ...fightOf(S), [`implement:${S}`]: ralphBlocked, [`implement:${S}@opus-high`]: green(`implement:${S}@opus-high`),
  })
  clean(r)
  assert.deepEqual(triples(r), [
    [`implement:${S}`, 'fable', 'high'], [`implement:${S}@opus-high`, 'fable', 'high'], [`review:${S} r1`, 'opus', 'xhigh'],
    [`revise:${S} r2`, 'fable', 'high'], [`review:${S} r2`, 'opus', 'xhigh'],
  ])
  const first = callOf(r, `implement:${S}`).prompt
  assert.ok(first.includes('Max iterations: 3') && !first.includes('EXACTLY ONCE'), 'the first pass is the full loop')
  const retry = callOf(r, `implement:${S}@opus-high`).prompt
  assert.ok(retry.includes('Max iterations: 2'), 'the same-rung retry gets CAPPED_RETRY_ITERATIONS')
  assert.ok(retry.includes('SECOND PASS') && retry.includes(OWN_TEXT) && !retry.includes("the ladder's top rung") && !retry.includes('ONE RUNG UP'), retry.slice(-900))
  assert.deepEqual(r.row.climbs, [{ stage: 'implement', from: 'opus-high', to: 'opus-high' }, { stage: 'review', from: 'opus-high', to: 'opus-high' }])
  assert.deepEqual([r.row.startRung, r.row.rung], ['opus-high', 'opus-high'])
  assert.ok(r.logs.includes(`climb: ${S} stays on opus-high (implement, a recorded no-op: builder runs on its own model)`), r.logs.join('\n'))
  assert.ok(r.logs.includes(`climb: ${S} stays on opus-high (review, a recorded no-op: builder runs on its own model)`), r.logs.join('\n'))
  // The read-only investigator in its fable arm: the same no-op, with the read-only contract.
  const R = 'proj-arm-ro'
  const ro = await run(mkArgs(mkTask(R, { scope: 'read-only', arms: { investigator: 'fable' } }), { ladder }), {
    [`investigate:${R}`]: { ...ralphBlocked, worktreePath: '' },
    [`investigate:${R}@opus-high`]: { ...green(`investigate:${R}@opus-high`), prUrl: '', branch: '' },
  })
  clean(ro)
  assert.deepEqual(triples(ro), [[`investigate:${R}`, 'fable', 'high'], [`investigate:${R}@opus-high`, 'fable', 'high']])
  const second = callOf(ro, `investigate:${R}@opus-high`).prompt
  assert.ok(second.includes('SECOND PASS: a first attempt at this investigation') && second.includes(OWN_TEXT), second.slice(-700))
  assertNoCodeFraming(second, 'the own-model investigator retry')
  assert.deepEqual(ro.row.climbs, [{ stage: 'implement', from: 'opus-high', to: 'opus-high' }])
})

test('arms: an opus arm over a fable role model runs on the rung; a none arm lets the role model apply', async (t) => {
  const ladder = ladderFrom(t, BUILT_IN_RUNGS, { builder: 'fable' })
  const S = 'proj-arm-over'
  const script = { [`implement:${S}`]: green(`implement:${S}`), [`review:${S} r1`]: approve }
  const opus = await run(mkArgs(mkTask(S, { arms: { builder: 'opus' } }), { ladder }), script)
  clean(opus)
  assert.deepEqual(triples(opus), [[`implement:${S}`, 'opus', 'high'], [`review:${S} r1`, 'opus', 'xhigh']])
  assert.ok(oneShot(callOf(opus, `implement:${S}`).prompt), 'an opus arm on an opus rung is the rung: one-shot below the top')
  const none = await run(mkArgs(mkTask(S, { arms: { builder: 'none' } }), { ladder }), script)
  clean(none)
  assert.deepEqual(triples(none), [[`implement:${S}`, 'fable', 'high'], [`review:${S} r1`, 'opus', 'xhigh']])
})

test('arms: plan dispatches are unchanged under any arms', async (t) => {
  for (const ladder of [ladderFrom(t, P3), ladderFrom(t, BUILT_IN_RUNGS)]) {
    const S = 'proj-arm-plan'
    const script = {
      [`plan:${S}`]: plan, [`plan-judge:${S} r1`]: changes('tighten'), [`plan-revise:${S} r2`]: plan, [`plan-judge:${S} r2`]: approve,
      [`implement:${S}`]: green(`implement:${S}`), [`review:${S} r1`]: approve,
    }
    const task = (arms) => mkTask(S, { scope: 'cross-cutting', planGate: true, ...(arms ? { arms } : {}) })
    const armed = await run(mkArgs(task({ 'master-review': 'fable', builder: 'fable' }), { ladder }), script)
    const bare = await run(mkArgs(task(), { ladder }), script)
    clean(armed)
    clean(bare)
    const planOnly = (r) => r.calls.filter((c) => c.label.startsWith('plan')).map((c) => [c.label, c.model, c.effort, c.prompt])
    assert.deepEqual(planOnly(armed), planOnly(bare))
    assert.deepEqual(armed.row.climbs.filter((c) => c.stage === 'plan'), bare.row.climbs.filter((c) => c.stage === 'plan'), 'the plan stage climbs as before')
  }
})

test('arms: on an all-Fable start rung the rung wins, and its climbs are top-rung no-ops', async (t) => {
  const ladder = ladderFrom(t, THREE)
  const S = 'proj-arm-top'
  const r = await run(mkArgs(mkTask(S, { rung: 'fable-high', arms: { builder: 'opus', 'master-review': 'opus' } }), { ladder }), {
    [`implement:${S}`]: ralphBlocked, [`implement:${S}@fable-high`]: green(`implement:${S}@fable-high`), [`review:${S} r1`]: approve,
  })
  clean(r)
  assert.deepEqual(triples(r), [[`implement:${S}`, 'fable', 'high'], [`implement:${S}@fable-high`, 'fable', 'high'], [`review:${S} r1`, 'fable', 'max']])
  const retry = callOf(r, `implement:${S}@fable-high`).prompt
  assert.ok(retry.includes("the ladder's top rung") && !retry.includes(OWN_TEXT), 'the top-rung text keeps its bytes')
})

test('arms: none everywhere is byte-identical to no arms, and logs no arms line', async (t) => {
  const ladder = ladderFrom(t, BUILT_IN_RUNGS)
  const S = 'proj-arm-none'
  const script = { ...fightOf(S), [`implement:${S}`]: redOneShot, [`implement:${S}@opus-xhigh`]: green(`implement:${S}@opus-xhigh`) }
  const none = await run(mkArgs(mkTask(S, { arms: { 'master-review': 'none', builder: 'none' } }), { ladder }), script)
  const bare = await run(mkArgs(mkTask(S), { ladder }), script)
  clean(none)
  clean(bare)
  assert.deepEqual(none.calls, bare.calls)
  assert.deepEqual(none.logs, bare.logs)
  assert.deepEqual(none.row, bare.row)
  assert.ok(!none.logs.some((l) => l.startsWith('arms:')))
  const E = loadEngine(['taskArmsError', 'ARM_ROLES', 'ARM_VALUES', 'armOf', 'fixedPass'])
  assert.deepEqual(JSON.parse(JSON.stringify(E.ARM_ROLES)), ['master-review', 'builder', 'investigator'])
  assert.deepEqual(JSON.parse(JSON.stringify(E.ARM_VALUES)), ['opus', 'fable', 'none'])
  assert.equal(E.taskArmsError({ 'master-review': 'fable', builder: 'none', investigator: 'opus' }), '')
  const st = { rungs: BUILT_IN_RUNGS, at: 0, roles: {}, arms: { builder: 'fable', 'master-review': 'none' } }
  assert.deepEqual([E.armOf(st, 'builder'), E.armOf(st, 'master-review'), E.armOf(st, 'investigator')], ['fable', '', ''])
  assert.deepEqual([E.fixedPass(st, 'builder'), E.fixedPass(st, 'master-review'), E.fixedPass(st, null)], [true, false, false])
})
