// skills/reflect/scripts/arms.py — the weekly reading's arms (p46-4, ADR 0079 d9): each drawn role's Opus and Fable
// arms side by side, the plans' before and after, the Fable calls by kind, and the Fable ceiling a role's share moves
// by once three Reflections agree (ADR 0037 d5). Every rule lives in arms.py's docstring; this pins the behaviour.
//
// Most cases call arms.reading() through one python harness (JSON in, JSON out, dict-backed stamps), so none waits on
// score.py. decide, close and moot run reflect.py on a hand-written span.json whose `arms` block is the harness's own
// reading, in a temp HOME, events dir and vault. One case runs `reflect.py span` end to end. Hermetic: each case gets its
// own mkdtemp HOME, THREAD_EVENTS_DIR and tasks dir, TZ pinned to Melbourne, and an env built from scratch.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ARMS_PY = path.join(root, 'skills', 'reflect', 'scripts', 'arms.py')
const REFLECT = path.join(root, 'skills', 'reflect', 'scripts', 'reflect.py')
const RUN_RECORD = path.join(root, 'skills', '_shared', 'scripts', 'run_record.py')

// ---- helpers ----------------------------------------------------------------------------------------------

function setup(t) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'reflect-arms-')))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const tasks = path.join(home, 'Tasks')
  for (const d of ['Archive/2026', 'Archive/Rollouts']) fs.mkdirSync(path.join(tasks, d), { recursive: true })
  for (const d of ['events', 'out']) fs.mkdirSync(path.join(home, d), { recursive: true })
  return { home, tasks, ev: path.join(home, 'events'), out: path.join(home, 'out') }
}
const env = (h) => ({ PATH: process.env.PATH, HOME: h.home, PYTHONDONTWRITEBYTECODE: '1', TZ: 'Australia/Melbourne',
  THREAD_EVENTS_DIR: h.ev, GIT_CONFIG_GLOBAL: path.join(h.home, 'gitconfig') })
function reflect(h, args) {
  const r = spawnSync('python3', ['-B', REFLECT, ...args], { encoding: 'utf8', cwd: h.home, env: env(h) })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}
function ok(h, args) {
  const r = reflect(h, args)
  assert.equal(r.status, 0, `${args[0]}: ${r.stderr}`)
  return r
}
const parse = (l) => { try { return JSON.parse(l) } catch { return null } }
const rlines = (h) => {
  const f = path.join(h.ev, 'reflections.jsonl')
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').map(parse).filter(Boolean) : []
}
const sha = (f) => (fs.existsSync(f) ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') : 'absent')

// The window: a past week, Melbourne midnight to midnight.
const SINCE = '2026-11-02T13:00:00.000Z'
const UNTIL = '2026-11-09T13:00:00.000Z'
const W = (d, hm) => `2026-11-0${d}T${hm}:00.000Z` // inside the window for d in 3..8
const BEFORE = (hm) => `2026-10-30T${hm}:00.000Z`  // before since
const AFTER = (hm) => `2026-11-10T${hm}:00.000Z`   // after until

// A record: rows [ts, kind, task, fields] -> [[ms, n, line]] in time then file order, as span reads one.
function rec(slug, rows) {
  return rows.map(([ts, kind, task, f = {}], n) => [Date.parse(ts), n, { v: 1, ts, host: 'h', rollout: slug, task, kind, ...f }])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
}
// One role-call segment line (run_record's role-call): written at `ts` (the fold), its call started at `start`.
const rc = (ts, task, role, start, o = {}) => [ts, 'role-call', task, { runId: o.runId ?? `wf-${task}`, startTime: Date.parse(start),
  call: 'task', role, model: o.model ?? (o.arm === 'fable' ? 'fable' : 'opus'), effort: 'high', dispatches: 1, outcome: 'completed',
  tokens: o.tokens ?? 1000, ...Object.fromEntries(Object.entries(o).filter(([k]) => !['runId', 'model', 'tokens'].includes(k))) }]
const verdict = (ts, task, round, v, digest = `d-${task}-${round}`) =>
  [ts, 'review-verdict', task, { round, verdict: v, findings: v === 'approve' ? 0 : 2, original: 0, regression: 0, digest }]
const slot = (ts, task, rung) => [ts, 'slot-taken', task, { settings: { parallel_ceiling: 2, ...(rung ? { rung } : {}) }, start: 'start' }]
const merged = (ts, task, pr = 1, o = {}) => [ts, 'merged', task, { pr, ...o }]

// A build task's week, day d: its Slot, a builder and a master-review call (one Workflow call), round 1, and its merge.
// A builder of `none` (a task that is not hard) runs with no arm on its line.
function build(task, d, { arm = 'opus', builder = arm, tokens = 1000, v = 'approve', climbs, extra = {} } = {}) {
  const c = climbs ? { climbs } : {}
  const b = builder === 'none' ? {} : { arm: builder }
  return [slot(W(d, '01:00'), task), rc(W(d, '04:00'), task, 'builder', W(d, '01:05'), { ...b, tokens, ...c, ...extra }),
    rc(W(d, '04:00'), task, 'master-review', W(d, '02:00'), { arm, tokens, ...extra }), verdict(W(d, '02:30'), task, 1, v),
    merged(W(d, '03:00'), task)]
}
const stampOf = (arm, builder = arm) => ({ 'master-review': arm, builder })

// arms.reading() over `a` (records, stamps, leads, handsOff, escapes, ...), with its holds_row() and line(); a list of
// inputs reads each in one spawn.
const HARNESS = ['import importlib.util, json, sys',
  'spec = importlib.util.spec_from_file_location("arms", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
  'def one(a):',
  '    recs = {k: [tuple(x) for x in v] for k, v in a["records"].items()}',
  '    stamps, leads = a.get("stamps") or {}, a.get("leads") or {}',
  '    block = m.reading(recs, a["since"], a["until"], read=a.get("read") or sorted(recs), arm_stamp=lambda t: stamps.get(t),',
  '        lead_stamp=lambda r: leads.get(r), hands_off=a.get("handsOff") or {}, escapes=a.get("escapes") or [],',
  '        breaches=[tuple(x) for x in a.get("breaches") or []], share=a.get("share"), share_error=a.get("shareError"),',
  '        bounds=a.get("bounds") or {"tokens_per_merge_pct": 25}, bounds_error=None, earlier=a.get("earlier") or [],',
  '        canon=lambda v: v.lower() if isinstance(v, str) else "", built_in=a.get("builtIn") or ["opus-high", "opus-xhigh"])',
  '    return {"block": block, "holds": m.holds_row(block), "line": m.line(block, a.get("rid", "r-20261109T130000Z-aaaaaa"), a["sinceZ"], a["untilZ"])}',
  'a = json.load(sys.stdin)',
  'print(json.dumps([one(x) for x in a] if isinstance(a, list) else one(a)))',
].join('\n')
const input = (a) => ({ since: Date.parse(a.sinceZ ?? SINCE), until: Date.parse(a.untilZ ?? UNTIL), sinceZ: a.sinceZ ?? SINCE, untilZ: a.untilZ ?? UNTIL, ...a })
function reading(h, a) {
  const r = spawnSync('python3', ['-B', '-c', HARNESS, ARMS_PY], { encoding: 'utf8', cwd: h.home, env: env(h),
    input: JSON.stringify(Array.isArray(a) ? a.map(input) : input(a)) })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}
// The handsOff map span builds from each landing rollout's score.json: every listed task hands-off unless `acts` says.
const handsOff = (byRollout, acts = {}) => Object.fromEntries(Object.entries(byRollout).map(([r, ts]) =>
  [r, Object.fromEntries(ts.map((t) => [t, acts[t] ?? []]))]))
const pick = (arm, keys) => Object.fromEntries(keys.map((k) => [k, arm[k]]))

// ---- the arms per drawn role ----------------------------------------------------------------------------------

test('both arms per drawn role and the lead, each figure with its count; a planted out-of-window row adds nothing', (t) => {
  const h = setup(t)
  const a = rec('ra', [...build('a1', 3), ...build('a2', 4, { v: 'changes' }), ...build('a3', 5),
    verdict(W(5, '05:00'), 'a2', 2, 'approve'),
    // planted outside the window: a call, a review and a merge before since, and a merge after until
    slot(BEFORE('01:00'), 'old'), rc(BEFORE('04:00'), 'old', 'master-review', BEFORE('02:00'), { arm: 'opus' }),
    verdict(BEFORE('02:30'), 'old', 1, 'changes'), merged(BEFORE('03:00'), 'old'),
    rc(AFTER('04:00'), 'late', 'master-review', AFTER('02:00'), { arm: 'opus' }), merged(AFTER('03:00'), 'late')])
  const b = rec('rb', [...build('b1', 3, { arm: 'fable', tokens: 3000 }), ...build('b2', 4, { arm: 'fable', tokens: 3000 }),
    ...build('b3', 6, { arm: 'fable', tokens: 3000 }),
    // an investigator task on each arm (scope: read-only lands read-only)
    slot(W(6, '01:00'), 'i1'), rc(W(6, '04:00'), 'i1', 'investigator', W(6, '01:05'), { arm: 'fable', tokens: 500 }), merged(W(6, '03:00'), 'i1', null, { readOnly: true }),
    slot(W(7, '01:00'), 'i2'), rc(W(7, '04:00'), 'i2', 'investigator', W(7, '01:05'), { arm: 'opus', tokens: 400 }), merged(W(7, '03:00'), 'i2', null, { readOnly: true })])
  const stamps = { a1: stampOf('opus'), a2: stampOf('opus'), a3: stampOf('opus'), b1: stampOf('fable'), b2: stampOf('fable'), b3: stampOf('fable'),
    i1: { investigator: 'fable' }, i2: { investigator: 'opus' }, old: stampOf('opus'), late: stampOf('opus') }
  const { block, holds } = reading(h, { records: { ra: a, rb: b }, stamps, leads: { ra: 'opus', rb: 'fable' },
    handsOff: handsOff({ ra: ['a1', 'a2', 'a3'], rb: ['b1', 'b2', 'b3', 'i1', 'i2'] }, { a2: [{ kind: 'answer' }] }),
    escapes: [{ kind: 'escape', rollout: 'ra', task: 'a3', source: 'fixes', at: '2026-11-06', inWindow: true },
      { kind: 'escape', rollout: 'ra', task: 'a1', source: 'fixes', at: '2026-10-20', inWindow: false }] })
  assert.ok(holds)
  const mr = block.roles['master-review']
  assert.deepEqual(pick(mr.opus, ['landed', 'handsOff', 'handsOffUnknown', 'handsOffRate', 'firstApprove', 'firstChanges', 'reviewRounds',
    'reviewedTasks', 'escapes', 'escapesPerLanded', 'calls', 'tokens', 'roleTokens', 'tokenTasks', 'tokensLeftOut', 'tokensPerMerge']),
  { landed: 3, handsOff: 2, handsOffUnknown: 0, handsOffRate: 0.6667, firstApprove: 2, firstChanges: 1, reviewRounds: 4, reviewedTasks: 3,
    escapes: 1, escapesPerLanded: 0.3333, calls: 3, tokens: 6000, roleTokens: 3000, tokenTasks: 3, tokensLeftOut: 0, tokensPerMerge: 2000 })
  assert.deepEqual(pick(mr.fable, ['landed', 'handsOff', 'handsOffRate', 'firstApprove', 'reviewRounds', 'escapes', 'calls', 'tokens', 'tokensPerMerge']),
    { landed: 3, handsOff: 3, handsOffRate: 1, firstApprove: 3, reviewRounds: 3, escapes: 0, calls: 3, tokens: 18000, tokensPerMerge: 6000 })
  assert.deepEqual([block.roles.builder.opus.landed, block.roles.builder.fable.landed, block.roles.builder.opus.roleTokens], [3, 3, 3000])
  const inv = block.roles.investigator
  assert.deepEqual([inv.opus.landed, inv.fable.landed, inv.opus.tokens, inv.fable.tokens, inv.opus.reviewRounds], [1, 1, 400, 500, 0])
  const lead = block.roles.lead
  assert.deepEqual([lead.opus.landed, lead.fable.landed, lead.opus.roleTokens, lead.fable.tokens], [3, 5, null, 18900])
  assert.deepEqual(lead.opus.calls, 6, 'the lead counts every role\'s calls in its rollouts')
  assert.deepEqual(mr.excluded, { fellBack: 0, fableRung: 0, none: 0 }, 'an investigator task has no master-review arm, so it is no `none` there')
  assert.deepEqual(block.tasks.map((x) => x.task).sort(), ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'i1', 'i2'], 'old and late hold no landed row')
  assert.ok(!block.calls.some((c) => ['old', 'late'].includes(c.task)), 'the planted calls hold no call row')
  assert.ok(!block.reviews.some((r) => r.task === 'old'))
  assert.deepEqual(block.escapes.map((x) => x.task), ['a3'], 'an Escape the sweep dated outside the window is no row')
})

test('each row by its own unit: a carried task lands once, at its first merge, its lead Escape with it; a resume\'s earlier segment, a re-merge, an earlier rejection and an earlier round 1 add nothing; a whole-life token line before since counts', (t) => {
  const h = setup(t)
  const a = rec('ra', [...build('c1', 4),
    // a resumed call: its first segment before since (climbs 2), its second in the window (climbs 1); one runId
    slot(BEFORE('00:30'), 'k1'), rc(BEFORE('04:00'), 'k1', 'master-review', BEFORE('02:00'), { arm: 'opus', tokens: 500, climbs: 2 }),
    rc(W(5, '04:00'), 'k1', 'master-review', W(5, '02:00'), { arm: 'opus', tokens: 700, climbs: 1 }), merged(W(5, '03:00'), 'k1'),
    merged(BEFORE('05:00'), 'o1'),
    slot(BEFORE('06:00'), 'p1'), [BEFORE('07:00'), 'set-aside', 'p1', { stage: 'plan', reasonClass: 'plan-rejected', setAsideAt: 'run' }],
    // two round-1 lines (two digests): the first review, a changes, came before since; the in-window approve is no first
    verdict(BEFORE('08:00'), 'v1', 1, 'changes', 'dA'), verdict(W(5, '06:00'), 'v1', 1, 'approve', 'dB')])
  // the carried task re-merged in rb, and o1 (first merged before since) re-merged in the window
  const b = rec('rb', [merged(W(6, '03:00'), 'c1', 2), merged(W(6, '04:00'), 'o1', 2)])
  const { block } = reading(h, { records: { ra: a, rb: b }, stamps: { c1: stampOf('opus'), k1: stampOf('opus'), o1: stampOf('fable'), v1: stampOf('fable') },
    leads: { ra: 'opus', rb: 'fable' }, handsOff: handsOff({ ra: ['c1', 'k1'], rb: ['c1', 'o1'] }),
    escapes: [{ kind: 'escape', rollout: 'rb', task: 'c1', source: 'fixes', at: '2026-11-07', inWindow: true }] })
  const lead = block.roles.lead
  assert.deepEqual([lead.opus.landed, lead.opus.escapes, lead.fable.landed, lead.fable.escapes], [2, 1, 0, 0],
    'c1 lands once, in ra, and its Escape the sweep credits to rb counts under ra\'s lead')
  assert.deepEqual(block.tasks.map((x) => [x.task, x.rollout]), [['c1', 'ra'], ['k1', 'ra']], 'o1\'s re-merge places no landed row')
  assert.deepEqual(block.escapes.map((x) => [x.task, x.rollout]), [['c1', 'ra']])
  const mr = block.roles['master-review'].opus
  assert.deepEqual([mr.calls, mr.climbs], [2, 1], 'the resume\'s earlier segment adds no call and no climb')
  assert.equal(block.calls.find((c) => c.task === 'k1').startTime, W(5, '02:00'))
  assert.deepEqual([mr.tokens, mr.roleTokens, mr.tokenTasks], [3200, 2200, 2], 'k1\'s whole life, its segment before since included')
  const fv = block.roles['master-review'].fable
  assert.deepEqual([fv.firstApprove, fv.firstChanges, fv.reviewRounds, fv.reviewedTasks], [0, 0, 1, 1],
    'v1\'s first round 1 came before since: its in-window round 1 is a review row, never a first verdict')
  assert.deepEqual([block.plans.week.before.rejected, block.plans.toDate.before.rejected, block.plans.toDate.before.tasks], [0, 1, 3])
  assert.deepEqual(block.rejections, [], 'the earlier rejection is no row of this week')
})

test('exclusions: fellBack leaves one role, fableRung every role; tokensPartial and no role-call line leave tokens; no stamp and no armed call is none; the record wins over its stamp, flagged', (t) => {
  const h = setup(t)
  const r = rec('rx', [
    ...build('f1', 3).map((x) => (x[1] === 'role-call' && x[3].role === 'master-review' ? [x[0], x[1], x[2], { ...x[3], fellBack: true }] : x)),
    ...build('g1', 3).map((x) => (x[1] === 'role-call' && x[3].role === 'builder' ? [x[0], x[1], x[2], { ...x[3], fableRung: true }] : x)),
    ...build('t1', 4).map((x) => (x[1] === 'role-call' && x[3].role === 'builder' ? [x[0], x[1], x[2], { ...x[3], tokensPartial: true }] : x)),
    slot(W(4, '05:00'), 's1'), merged(W(4, '06:00'), 's1'),
    slot(W(5, '05:00'), 'n1'), merged(W(5, '06:00'), 'n1'),
    ...build('d1', 5)])
  const stamps = { f1: stampOf('opus'), g1: stampOf('opus'), t1: stampOf('opus'), s1: stampOf('opus'), d1: stampOf('fable', 'opus') }
  const { block } = reading(h, { records: { rx: r }, stamps, leads: { rx: 'opus' }, handsOff: handsOff({ rx: ['f1', 'g1', 't1', 's1', 'n1', 'd1'] }) })
  const mr = block.roles['master-review']
  assert.deepEqual(mr.excluded, { fellBack: 1, fableRung: 1, none: 1 })
  assert.deepEqual(block.roles.builder.excluded, { fellBack: 0, fableRung: 1, none: 1 }, 'f1 fell back on its master review only')
  assert.deepEqual(block.roles.lead.excluded, { fellBack: 0, fableRung: 1, none: 0 }, 'a Fable-rung climb leaves the lead too')
  assert.deepEqual([block.roles.builder.opus.landed, mr.opus.landed, mr.fable.landed], [4, 3, 0], 'd1\'s master review reads the record\'s opus')
  assert.deepEqual([mr.opus.tokenTasks, mr.opus.tokensLeftOut, mr.opus.tokens], [1, 2, 2000], 't1 (tokensPartial) and s1 (no role-call) are left out')
  assert.ok(block.flags.includes('arms: a stamp the record overrides: [[d1]] master-review: stamp fable, record opus'), JSON.stringify(block.flags))
  assert.equal(block.tasks.find((x) => x.task === 'g1').arms.builder, 'fableRung')
})

// One week where `fableArm` wins (or loses, or trades) on the master review: three tasks per arm, the builder in no arm.
function week({ loss = false, trade = false, fableTokens = 1000 } = {}) {
  const fa = loss ? 'opus' : 'fable'
  const ob = loss ? 'fable' : 'opus'
  const records = { rw: rec('rw', [...['o1', 'o2', 'o3'].flatMap((x, i) => build(x, 3 + i, { arm: ob, builder: 'none', tokens: ob === 'fable' ? fableTokens : 1000 })),
    ...['f1', 'f2', 'f3'].flatMap((x, i) => build(x, 3 + i, { arm: fa, builder: 'none', tokens: fa === 'fable' ? fableTokens : 1000 }))]) }
  const stamps = Object.fromEntries([...['o1', 'o2', 'o3'].map((x) => [x, stampOf(ob, 'none')]), ...['f1', 'f2', 'f3'].map((x) => [x, stampOf(fa, 'none')])])
  // the o-tasks carry one act; on a trade the f-tasks carry two Escapes
  const escapes = trade ? ['f1', 'f2'].map((x) => ({ kind: 'escape', rollout: 'rw', task: x, source: 'fixes', at: '2026-11-07', inWindow: true })) : []
  return { records, stamps, escapes, handsOff: handsOff({ rw: ['o1', 'o2', 'o3', 'f1', 'f2', 'f3'] }, { o2: [{ kind: 'answer' }] }), share: { 'master-review': 0.5 } }
}
const earlierLine = (rid, verdict, signal, from = 50, role = 'master-review') => ({ kind: 'arms', reflection: rid, roles: { [role]: { verdict, ...(signal ? { signal } : {}), from } } })
const R = (n) => `r-2026102${n}T000000Z-00000${n}`

test('the hold order: agreement first (a thin week skipped, anything else ends the walk), then a trade, a Guardrail, a caution, else ready', (t) => {
  const h = setup(t)
  const win = (o = {}) => ({ ...week(), ...o })
  const W2 = [earlierLine(R(1), 'win', 'win'), earlierLine(R(2), 'win', 'win')]
  const TRADES = [earlierLine(R(1), 'trade', 'trade-handsOff'), earlierLine(R(2), 'trade', 'trade-handsOff')]
  const OVER = 'tokens per merge: fable 6000.0 over opus 2000.0 by more than 25 %'
  const cases = [
    ['one winning week', win(), { held: 'agreement 1 of 3', item: null, agreement: 1 }],
    ['three agreeing weeks', win({ earlier: W2 }), { held: 'agreed by 3 Reflections (ADR 0037 d5); no writer lands a Fable ceiling until [[thread-skill-p46-10-an-agreed-fable-ceiling-lands-on-its-own]]: Lachy decides', item: 'ceiling', agreement: 3, ready: true, to: 60, agreedWith: [R(2), R(1)] }],
    ['a thin week between is skipped', win({ earlier: [W2[0], earlierLine(R(3), 'thin'), W2[1]] }), { agreement: 3, item: 'ceiling' }],
    ['an even week ends the walk', win({ earlier: [W2[0], earlierLine(R(3), 'even'), W2[1]] }), { agreement: 2, item: null }],
    ['the opposite signal ends it', win({ earlier: [W2[0], earlierLine(R(3), 'loss', 'loss'), W2[1]] }), { agreement: 2, item: null }],
    ['a trade week ends it', win({ earlier: [W2[0], earlierLine(R(3), 'trade', 'trade-handsOff'), W2[1]] }), { agreement: 2, item: null }],
    ['another from ends it', win({ earlier: [W2[0], earlierLine(R(3), 'win', 'win', 40), W2[1]] }), { agreement: 2, item: null }],
    ['a rollout breach holds a widening', win({ earlier: W2, breaches: [['rz', 'throughput']] }), { held: 'a Guardrail is breached ([[rz]] throughput)', item: null, agreement: 3 }],
    ['Fable\'s tokens over the bound hold a widening', { ...week({ fableTokens: 3000 }), earlier: W2 },
      { held: 'a Guardrail is breached (tokens per merge: fable 6000.0 over opus 2000.0 by more than 25 %)', item: null }],
    ['a loss at agreement 1', week({ loss: true }), { verdict: 'loss', held: 'agreement 1 of 3', item: null, to: 40 }],
    ['a loss over three agreeing weeks with a breach is a caution', { ...week({ loss: true }), breaches: [['rz', 'throughput']],
      earlier: [earlierLine(R(1), 'loss', 'loss'), earlierLine(R(2), 'loss', 'loss')] },
    { held: 'a caution: Lachy decides', caution: 'risks [[rz]] throughput: a Guardrail against a Guardrail', item: 'ceiling', direction: -1 }],
    ['a single trade week', week({ trade: true }), { verdict: 'trade', signal: 'trade-handsOff', held: 'agreement 1 of 3', item: null }],
    ['three agreeing trade weeks', { ...week({ trade: true }), earlier: TRADES },
      { held: 'a trade (gains handsOffRate, costs quality): Lachy decides', caution: '', item: 'ceiling', to: 60, direction: 1 }],
    ['a trade with Fable\'s tokens over the bound names the breach as its caution', { ...week({ trade: true, fableTokens: 3000 }), earlier: TRADES },
      { held: 'a trade (gains handsOffRate, costs quality): Lachy decides', caution: `risks ${OVER}`, breached: [OVER], item: 'ceiling' }],
    ['no [share] for the role', win({ share: { builder: 0.5 } }), { from: null, held: 'no Fable ceiling for master-review (ladder.toml [share])', item: null }],
    ['a refused ladder', win({ share: null, shareError: 'unknown key' }), { from: null, item: null }],
    ['at the edge', win({ share: { 'master-review': 1 }, earlier: W2 }), { from: 100, held: 'at the edge: a Fable ceiling of 100% cannot move up', item: null }],
  ]
  const out = reading(h, cases.map((c) => c[1]))
  cases.forEach(([what, _a, want], i) => {
    const got = out[i].block.roles['master-review']
    assert.deepEqual(pick(got, Object.keys(want)), want, what)
  })
  assert.equal(out[1].block.roles['master-review'].kid, out[2].block.roles['master-review'].kid)
  assert.ok(out[15].block.flags.includes('arms: the ladder is refused (unknown key): no Fable ceiling is read'))
  assert.ok(!out[14].block.flags.some((f) => f.includes('ladder')), 'a share with no role is no flag')
  assert.equal(out[0].block.roles.lead.verdict, 'thin', 'the lead, in no arm, is thin')
  // the over-bound trade's decision-task line prints its caution and both arms' tokens per merge
  const r = spawnSync('python3', ['-B', '-c', ['import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("m", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'print(json.dumps([m.arms_item_line(x) for x in m.arms_items({"arms": json.load(sys.stdin)})]))'].join('\n'), REFLECT],
  { encoding: 'utf8', cwd: h.home, env: env(h), input: JSON.stringify(out[13].block) })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.stdout), [`- ceiling ${out[13].block.roles['master-review'].kid} at 50: Fable ceiling master-review 50% -> 60% ` +
    `(trade-handsOff); a trade (gains handsOffRate, costs quality): Lachy decides; caution risks ${OVER}; evidence opus 3 landed, ` +
    'Hands-off 0.6667, 0 Escape(s), tokens per merge 2000; fable 3 landed, Hands-off 1, 2 Escape(s), tokens per merge 6000; ' +
    `agreed with ${R(2)}, ${R(1)}; rollouts [[rw]]; a yes: the deciding session sets ~/.config/thread/ladder.toml [share] master-review = 0.6 ` +
    'and runs ladder.py'])
})

test('plans: the split at the first Fable planner call off the Fable rung; each side counts its tasks, planned or not, and leaves out only the other model\'s; per100 for the week and to date', (t) => {
  const h = setup(t)
  const reject = (ts, task) => [ts, 'set-aside', task, { stage: 'plan', reasonClass: 'plan-rejected', setAsideAt: 'run' }]
  const plan = (ts, task, o) => rc(ts, task, 'planner', ts, { runId: `wf-${task}`, ...o })
  const r = rec('rp', [
    slot(BEFORE('01:00'), 'q0'), reject(BEFORE('02:00'), 'q0'),
    slot(W(3, '00:00'), 'p0', 'opus-high'), plan(W(3, '00:10'), 'p0', { model: 'fable', fableRung: true }),
    slot(W(3, '01:00'), 'p1'),
    slot(W(3, '02:00'), 'p2', 'opus-xhigh'), plan(W(3, '02:10'), 'p2', { model: 'opus' }), reject(W(3, '03:00'), 'p2'),
    slot(W(3, '04:00'), 'p3', 'fable-high'), reject(W(3, '05:00'), 'p3'),
    slot(W(4, '00:00'), 'p4'), plan(W(4, '00:05'), 'p4', { model: 'fable' }),
    slot(W(5, '00:00'), 'p5'), plan(W(5, '00:05'), 'p5', { model: 'fable' }), reject(W(5, '01:00'), 'p5'),
    slot(W(5, '02:00'), 'p6'),
    slot(W(6, '00:00'), 'p7'), plan(W(6, '00:05'), 'p7', { model: 'fable', fellBack: true }),
    slot(W(6, '01:00'), 'p8'), plan(W(6, '01:05'), 'p8', { model: 'opus' })])
  const { block, holds } = reading(h, { records: { rp: r } })
  const p = block.plans
  assert.equal(p.split, W(4, '00:05'), 'p0\'s earlier Fable-rung planner call places no split')
  assert.deepEqual(p.week, {
    before: { tasks: 2, rejected: 1, per100: 50, leftOut: 1, onFable: 2 },
    after: { tasks: 2, rejected: 1, per100: 50, fellBack: 1, onOpus: 1 } })
  assert.deepEqual(p.toDate.before, { tasks: 3, rejected: 2, per100: 66.7, leftOut: 1, onFable: 2 })
  assert.equal(p.note, 'planning has no Opus arm: a before and after, not a comparison')
  assert.ok(block.flags.some((f) => f.startsWith('arms: plans: 1 task(s) left out of the before side') && f.includes('p3 (fable-high)')), JSON.stringify(block.flags))
  assert.deepEqual(block.planTasks.map((x) => [x.task, x.side, x.leftOut]), [['p0', 'before', 'onFable'], ['p1', 'before', null],
    ['p2', 'before', null], ['p3', 'before', 'leftOut'], ['p4', 'before', 'onFable'], ['p5', 'after', null], ['p6', 'after', null],
    ['p7', 'after', 'fellBack'], ['p8', 'after', 'onOpus']])
  assert.ok(holds, 'a non-null split is a row')
  const [before] = reading(h, [{ records: { rp: rec('rp', [slot(W(3, '01:00'), 'p1'), reject(W(3, '02:00'), 'p1')]) } }])
  assert.deepEqual([before.block.plans.split, before.holds], [null, false], 'a plans-before-only week holds no row')
})

test('Fable calls by kind, each call once; a fell-back call only on its own line, written only when some fell back; cannotShow names the Login it cannot read', (t) => {
  const h = setup(t)
  const r = rec('rf', [
    rc(W(3, '04:00'), 'g1', 'builder', W(3, '01:00'), { arm: 'fable', fableRung: true }),
    rc(W(3, '04:00'), 'p5', 'planner', W(3, '02:00'), { model: 'fable' }),
    rc(W(3, '04:00'), 'p5', 'plan-judge', W(3, '02:10'), { model: 'fable' }),
    rc(W(4, '04:00'), 'b1', 'master-review', W(4, '01:00'), { arm: 'fable' }),
    rc(W(4, '04:00'), 'b1', 'integrator', W(4, '02:00'), { model: 'fable', call: 'integrate' }),
    rc(W(5, '04:00'), 'b2', 'master-review', W(5, '01:00'), { arm: 'fable', fellBack: true }),
    rc(W(5, '04:00'), 'b2', 'builder', W(5, '01:10'), { arm: 'opus' })])
  const [fb, none] = reading(h, [{ records: { rf: r }, leads: { rf: 'fable' } }, { records: { rf: rec('rf', [rc(W(4, '04:00'), 'b1', 'master-review', W(4, '01:00'), { arm: 'fable' })]) } }])
  assert.deepEqual(fb.block.fableCalls, { fableRung: 1, plans: 2, 'master-review': 1, builder: 0, investigator: 0, other: 1, firstReviewer: null, leads: 1 })
  assert.deepEqual(fb.block.fellBack, { calls: 1, byKind: { fableRung: 0, plans: 0, 'master-review': 1, builder: 0, investigator: 0, other: 0 },
    line: '1 Fable call(s) fell back to Opus: another Login with Fable room would have carried them' })
  assert.ok(fb.block.cannotShow.some((c) => c.includes('whether another Login had Fable room')))
  assert.deepEqual([none.block.fellBack.calls, none.block.fellBack.line], [0, null])
  assert.equal(fb.line.fableCalls.firstReviewer, null)
})

test('holds_row: an empty week and an all-none week hold none; the line is run_record\'s arms kind', (t) => {
  const h = setup(t)
  const none = rec('rn', [slot(W(3, '01:00'), 'n1'), merged(W(3, '02:00'), 'n1'), verdict(W(3, '01:30'), 'n1', 1, 'approve')])
  const [empty, allNone, real] = reading(h, [{ records: {} }, { records: { rn: none }, handsOff: handsOff({ rn: ['n1'] }) }, week()])
  assert.deepEqual([empty.holds, allNone.holds, real.holds], [false, false, true])
  assert.equal(allNone.block.roles['master-review'].excluded.none, 1)
  const r = spawnSync('python3', ['-B', '-c', ['import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("rr", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'm.check(None, "arms", None, json.load(sys.stdin)); print("ok")'].join('\n'), RUN_RECORD], { encoding: 'utf8', env: env(h), input: JSON.stringify(real.line) })
  assert.equal(r.stdout, 'ok\n', r.stderr)
})

// ---- the window check (reflect.py's window_flags) --------------------------------------------------------------------

test('window_flags holds each arms row to the window: a planted call flags arms.calls; the real reading flags nothing', (t) => {
  const h = setup(t)
  const { block } = reading(h, week())
  const planted = { ...block, calls: [...block.calls, { ...block.calls[0], startTime: BEFORE('01:00') }],
    escapes: [{ task: 'x', at: '2026-11-04', inWindow: false }] }
  const doc = (arms) => ({ since: SINCE, until: UNTIL, rollouts: [], arms })
  const r = spawnSync('python3', ['-B', '-c', ['import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("m", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'print(json.dumps([m.window_flags(d, {}) for d in json.load(sys.stdin)]))'].join('\n'), REFLECT],
  { encoding: 'utf8', cwd: h.home, env: env(h), input: JSON.stringify([doc(planted), doc(block)]) })
  assert.equal(r.status, 0, r.stderr)
  const [bad, good] = JSON.parse(r.stdout)
  const F = (b, first) => `window: arms.${b} holds 1 row(s) outside [${SINCE}, ${UNTIL}], the first at ${first}: a reader read past its window`
  assert.deepEqual(bad, [F('calls', BEFORE('01:00')), F('escapes', '2026-11-04')])
  assert.deepEqual(good, [])
})

// ---- decide, close and moot on a Fable ceiling ---------------------------------------------------------------------------

const ARMS_LEAD = 'Fable ceilings for Lachy (ADR 0079 d9: three Reflections agreed on a move, a trade or a caution; no writer lands a ceiling until [[thread-skill-p46-10-an-agreed-fable-ceiling-lands-on-its-own]], so the session deciding this task applies a yes: it sets ladder.toml [share] <role> to the item\'s to, then runs ladder.py; a no is recorded when this task is done):'
const RID = (n) => `r-2026111${n}T000000Z-00000${n}`
function armsSpan(h, rid, block, until = UNTIL) {
  const p = path.join(h.out, `span-${rid}.json`)
  fs.writeFileSync(p, JSON.stringify({ reflection: rid, since: SINCE, until, previous: null, knobs: { revert: [], land: [], held: [] }, rollouts: [], arms: block }))
  return p
}

test('a ceiling on the decision task: decide lists it under its own lead, close refuses until it does and writes the arms line once, a later week keeps it open, moot answers it; ladder.toml and tunings.jsonl untouched', (t) => {
  const h = setup(t)
  const ladder = path.join(h.home, '.config', 'thread', 'ladder.toml')
  fs.mkdirSync(path.dirname(ladder), { recursive: true })
  fs.writeFileSync(ladder, '[[rung]]\nname = "opus-high"\nmodel = "opus"\neffort = "high"\njudge = "high"\nreview = "xhigh"\n\n[share]\nmaster-review = 0.5\n')
  const before = [sha(ladder), sha(path.join(h.ev, 'tunings.jsonl'))]
  const trades = [earlierLine(R(1), 'trade', 'trade-handsOff'), earlierLine(R(2), 'trade', 'trade-handsOff')]
  const [three, allNone] = reading(h, [{ ...week({ trade: true }), earlier: trades },
    { records: { rn: rec('rn', [slot(W(3, '01:00'), 'n1'), merged(W(3, '02:00'), 'n1')]) } }])
  const block = three.block
  const kid = block.roles['master-review'].kid
  const sp1 = armsSpan(h, RID(1), block)
  const early = reflect(h, ['close', '--span', sp1, '--tasks-dir', h.tasks])
  assert.equal(early.status, 2)
  assert.match(early.stderr, new RegExp(`held ceiling ${kid} at 50 has no decision task line from this Reflection: run decide`))
  assert.equal(ok(h, ['decide', '--span', sp1, '--tasks-dir', h.tasks, '--now', '2026-11-10T09:00+11:00']).stdout,
    'decision task thread-skill-decisions-2026-11-10 (new)\n')
  const slug = 'thread-skill-decisions-2026-11-10'
  const p = path.join(h.tasks, `${slug}.md`)
  const item = `- ceiling ${kid} at 50: Fable ceiling master-review 50% -> 60% (trade-handsOff); a trade (gains handsOffRate, costs quality): Lachy decides; ` +
    `evidence opus 3 landed, Hands-off 0.6667, 0 Escape(s), tokens per merge 2000; fable 3 landed, Hands-off 1, 2 Escape(s), tokens per merge 2000; ` +
    `agreed with ${R(2)}, ${R(1)}; rollouts [[rw]]; ` +
    'a yes: the deciding session sets ~/.config/thread/ladder.toml [share] master-review = 0.6 and runs ladder.py'
  assert.ok(fs.readFileSync(p, 'utf8').endsWith(`## Reflection ${RID(1)}\n\n${ARMS_LEAD}\n${item}\n`), fs.readFileSync(p, 'utf8'))
  assert.match(ok(h, ['close', '--span', sp1, '--tasks-dir', h.tasks]).stdout, /; arms written\n$/)
  const lines1 = rlines(h)
  assert.deepEqual(lines1.map((l) => [l.kind, l.reflection ?? l.id]), [['arms', RID(1)], ['reflection', RID(1)]])
  assert.deepEqual(pick(lines1[0].roles['master-review'], ['verdict', 'signal', 'from', 'to', 'kid', 'agreement', 'item']),
    { verdict: 'trade', signal: 'trade-handsOff', from: 50, to: 60, kid, agreement: 3, item: 'ceiling' })
  // a later week: still open, never listed twice; an arms line an earlier close wrote is never written again
  const sp2 = armsSpan(h, RID(2), block, '2026-11-16T13:00:00.000Z')
  ok(h, ['decide', '--span', sp2, '--tasks-dir', h.tasks, '--now', '2026-11-17T09:00+11:00'])
  const text2 = fs.readFileSync(p, 'utf8')
  assert.ok(text2.includes(`## Reflection ${RID(2)}\n\nNo new Fable ceilings; still open: ceiling ${kid} at 50 (see ## Still open)\n`), text2)
  assert.ok(text2.includes(`## Still open\n\nceiling ${kid} at 50 still open 2026-11-17: Reflection ${RID(2)}, rollouts [[rw]]\n`), text2)
  assert.equal(text2.split(`- ceiling ${kid} at 50: `).length, 2, 'listed once')
  fs.appendFileSync(path.join(h.ev, 'reflections.jsonl'), `${JSON.stringify({ ...lines1[0], ts: '2026-11-16T13:00:01.000Z', reflection: RID(2) })}\n`)
  assert.doesNotMatch(ok(h, ['close', '--span', sp2, '--tasks-dir', h.tasks]).stdout, /arms written/)
  assert.equal(rlines(h).filter((l) => l.kind === 'arms' && l.reflection === RID(2)).length, 1, 'a re-run writes no second arms line')
  // a yes that cannot apply: moot, under the item's own section
  assert.equal(ok(h, ['moot', '--task', slug, '--trade', kid, '--from', '50', '--why', 'ladder.toml read 0.6 already', '--tasks-dir', h.tasks,
    '--now', '2026-11-18T09:00+11:00']).stdout, `moot ceiling ${kid} at 50 in [[${slug}]] (## Reflection ${RID(1)})\n`)
  // a week whose block holds no row writes no arms line
  ok(h, ['close', '--span', armsSpan(h, RID(3), allNone.block, '2026-11-23T13:00:00.000Z'), '--tasks-dir', h.tasks])
  assert.deepEqual(rlines(h).filter((l) => l.reflection === RID(3) || l.id === RID(3)).map((l) => l.kind), ['reflection'])
  assert.deepEqual([sha(ladder), sha(path.join(h.ev, 'tunings.jsonl'))], before, 'nothing here writes ladder.toml or tunings.jsonl')
})

// ---- span, end to end ---------------------------------------------------------------------------------------------

test('span reads the arms end to end: the stamps from the notes, Hands-off from score.py, the ceiling from ladder.toml [share], agreement from closed Reflections only; no window flag', (t) => {
  const h = setup(t)
  fs.mkdirSync(path.join(h.home, '.config', 'thread'), { recursive: true })
  fs.writeFileSync(path.join(h.home, '.config', 'thread', 'ladder.toml'),
    '[[rung]]\nname = "opus-high"\nmodel = "opus"\neffort = "high"\njudge = "high"\nreview = "xhigh"\n\n[share]\nmaster-review = 0.5\n')
  const { records, stamps } = week()
  // every line through run_record.emit, so each is a line the record would hold; o2's act is a Recorded answer
  const rows = records.rw.map(([_ms, _n, d]) => { const { v, ts, host, rollout, task, kind, ...f } = d; return [ts, kind, task, f, rollout] })
  rows.push([W(4, '02:15'), 'answer-recorded', 'o2', { answerKind: 'decision' }, 'rw'])
  const emit = spawnSync('python3', ['-B', '-c', ['import importlib.util, json, sys', 'spec = importlib.util.spec_from_file_location("rr", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'for ts, kind, task, fields, r in json.load(sys.stdin):', '    assert m.emit(r, kind, task, fields, ts=ts, strict=True), (kind, task)'].join('\n'), RUN_RECORD],
  { encoding: 'utf8', env: env(h), input: JSON.stringify(rows) })
  assert.equal(emit.status, 0, emit.stderr)
  for (const [task, s] of Object.entries(stamps)) {
    fs.writeFileSync(path.join(h.tasks, `${task}.md`), ['---', 'tags: [task, ai]', 'status: done', 'rollout: "[[rw]]"',
      `arms: master-review=${s['master-review']} builder=${s.builder}`, '---', '', `# ${task}`, ''].join('\n'))
  }
  fs.writeFileSync(path.join(h.tasks, 'rw.md'), ['---', 'tags: [rollout]', 'status: in_progress', 'protocol_version: 5', 'arms: lead=opus', '---', '', '# rw', ''].join('\n'))
  // two closed Reflections agreed; a newer arms line whose Reflection never closed is no agreement and no break
  const old = (rid, signal, ts) => [{ v: 1, ts, host: 'h', rollout: null, task: null, kind: 'arms', ...earlierLine(rid, signal, signal) },
    { v: 1, ts, host: 'h', rollout: null, task: null, kind: 'reflection', id: rid }]
  const lines = [...old(R(1), 'win', '2026-10-21T00:00:00.000Z'), ...old(R(2), 'win', '2026-10-22T00:00:00.000Z'),
    old(R(3), 'loss', '2026-10-23T00:00:00.000Z')[0]]
  fs.writeFileSync(path.join(h.ev, 'reflections.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  const out = path.join(h.out, 'span.json')
  ok(h, ['span', '--tasks-dir', h.tasks, '--config', path.join(h.home, 'rollouts.toml'), '--since', SINCE, '--until', UNTIL, '--out', out])
  const s = JSON.parse(fs.readFileSync(out, 'utf8'))
  assert.deepEqual(s.flags.filter((f) => f.startsWith('window: ')), [], 'the window check holds')
  const mr = s.arms.roles['master-review']
  assert.deepEqual([mr.opus.landed, mr.opus.handsOff, mr.fable.landed, mr.fable.handsOff], [3, 2, 3, 3], 'score.py\'s acts, read whole')
  assert.deepEqual(pick(mr, ['verdict', 'from', 'to', 'agreement', 'agreedWith', 'ready', 'item']),
    { verdict: 'win', from: 50, to: 60, agreement: 3, agreedWith: [R(2), R(1)], ready: true, item: 'ceiling' })
  assert.deepEqual([s.arms.roles.lead.opus.landed, s.arms.roles.builder.excluded.none], [6, 6])
  assert.ok(s.cannotShow.some((c) => c.startsWith('arms: ')), 'a block that holds a row brings its cannotShow')
})
