// skills/reflect/scripts/score.py — a Reflection's scoring script (p15-5, ADR 0032; p21-2, ADR 0037 d1): the two
// headlines (Hands-off rate, Quality's slot), the Guardrails (Throughput's absolute bound among them) against a baseline,
// Slot and lane utilisation, load, the binding constraint and the weighed proposals.
//
// Hermetic: each case gets its own mkdtemp HOME and THREAD_EVENTS_DIR, an env built from scratch, and that HOME
// as cwd. Same-host record lines go through run_record.py's own emit (one python process per fixture, each line
// with its ts), so every fixture passes the real schema; the one other-host record is written by hand in
// run_record's line format, because emit stamps `host` itself and refuses a host field. The rollout note and the
// settings JSON are temp files. TZ is pinned to Melbourne, so a note's `captured` midnight is the one Lachy sees.
// Times: Mon = 2026-10-05, all UTC.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCORE = path.join(root, 'skills', 'reflect', 'scripts', 'score.py')
const ESCAPES = path.join(root, 'skills', 'reflect', 'scripts', 'escapes.py') // score.py loads it
const RUN_RECORD = path.join(root, 'skills', '_shared', 'scripts', 'run_record.py')

// ---- helpers ----------------------------------------------------------------------------------------------

function tmpHome(t) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'reflect-score-')))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  return home
}

const evDir = (home) => path.join(home, 'events')
const baseEnv = (home, env = {}) => ({ PATH: process.env.PATH, HOME: home, PYTHONDONTWRITEBYTECODE: '1', TZ: 'Australia/Melbourne', THREAD_EVENTS_DIR: evDir(home), ...env })

// `2026-10-0<day>T<hh:mm>:00Z`; at('06:30') is Monday.
const D = (day, hm) => `2026-10-0${day}T${hm}:00Z`
const at = (hm) => D(5, hm)
const ms = (stamp) => Date.parse(stamp)
const Z = (stamp) => new Date(ms(stamp)).toISOString() // the scorer's UTC form, milliseconds included
const S = (c, extra = {}) => ({ parallel_ceiling: c, max_review_rounds: 4, max_iterations: 3, max_plan_rounds: 3, ...extra })

// Every event through run_record.emit(strict=True) in one python process: [ts, kind, task, fields, rollout?].
function emitAll(home, rollout, events) {
  const body = [
    'import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("run_record", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'for ts, kind, task, fields, r in json.load(sys.stdin):',
    '    assert m.emit(r, kind, task, fields, ts=ts, strict=True), (kind, task, ts)',
  ].join('\n')
  const rows = events.map(([ts, kind, task = null, fields = {}, r = rollout]) => [ts, kind, task, fields, r])
  const r = spawnSync('python3', ['-B', '-c', body, RUN_RECORD], { encoding: 'utf8', cwd: home, env: baseEnv(home), input: JSON.stringify(rows) })
  assert.equal(r.status, 0, r.stderr)
}

// One task's life: a Slot from..to (ready at its end), then a lane holding, then its merge. A terminal call journal
// ends a minute before the Slot frees, unless journal is false (or an object to merge into the journal line). The
// journal line is stamped at the Slot's end, or at `fold` (fold-journals stamps the fold time, not the call's).
function life(slug, { from, to, c, lane, settings, journal = true, merged = true, tokens = 100000, outcome = 'ready', fold = to }) {
  const out = [
    [from, 'slot-taken', slug, { settings: settings || S(c), start: 'start' }],
    [from, 'run-bound', slug, { runId: `wf_${slug}`, journalDir: '/nonexistent/workflows', call: 'task' }],
    [to, 'slot-freed', slug, { outcome }],
  ]
  if (outcome === 'ready') out.push([to, 'ready', slug, { pr: 7 }])
  if (journal) {
    const j = { runId: `wf_${slug}`, status: 'completed', mode: 'task', startTime: ms(from), durationMs: ms(to) - ms(from) - 60000, tokens }
    out.push([fold, 'call-journal', null, typeof journal === 'object' ? { ...j, ...journal } : j])
  }
  if (lane) {
    out.push([lane[0], 'lane-taken', slug, {}])
    out.push([lane[1], 'lane-freed', slug, { release: 'merge', path: 'lead', triggers: [], conflict: false }])
    if (merged) out.push([lane[1], 'merged', slug, { pr: 7 }])
  }
  return out
}

const byTs = (events) => [...events].sort((a, b) => ms(a[0]) - ms(b[0]))

// A Slot-bound run at ceiling c: c Slots from 00:00, the i-th freeing at 04:00 + 10(i-1) min, each integrating
// for 10 min straight away (so no wait, no climb). Running time: 4 h + c x 10 min.
function saturated(c, { settings, prefix = 't', start = 0 } = {}) {
  const hm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
  const ev = []
  for (let i = 0; i < c; i++) {
    const free = start + 240 + 10 * i
    ev.push(...life(`${prefix}${i + 1}`, { from: at(hm(start)), to: at(hm(free)), c, settings: settings && settings(i), lane: [at(hm(free)), at(hm(free + 10))] }))
  }
  return ev
}

function writeSettings(home, values, { file = null, repo = 'o/r', guardrails = {} } = {}) {
  const settings = {}
  for (const k of ['parallel_ceiling', 'max_review_rounds', 'max_iterations', 'max_plan_rounds']) {
    settings[k] = { value: values[k] ?? { parallel_ceiling: 4, max_review_rounds: 4, max_iterations: 3, max_plan_rounds: 3 }[k], source: file ? 'file:repo' : 'built-in' }
  }
  const g = { tokens_per_merge_pct: 25, set_aside_rate_points: 5, conflict_rate_points: 10, quota_stalls: 0, review_churn_pct: 40, hours_per_task: 1.5, ...guardrails }
  const doc = {
    path: file || path.join(home, '.config', 'thread', 'rollouts.toml'), file: !!file, repo,
    settings, guardrails: Object.fromEntries(Object.entries(g).map(([k, v]) => [k, { value: v, source: 'built-in' }])),
  }
  const p = path.join(home, 'settings.json')
  fs.writeFileSync(p, JSON.stringify(doc))
  return p
}

function writeToml(home, mtime) {
  const p = path.join(home, '.config', 'thread', 'rollouts.toml')
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, '[defaults]\nparallel_ceiling = 3\n')
  const t = new Date(mtime)
  fs.utimesSync(p, t, t)
  return p
}

function writeNote(home, fm) {
  const p = path.join(home, 'demo-rollout-2026-10-04.md')
  const lines = ['---', 'tags: [rollout]', 'status: in_progress', 'protocol_version: 5', ...Object.entries(fm).map(([k, v]) => `${k}: ${v}`), '---', '', '# demo', '']
  fs.writeFileSync(p, lines.join('\n'))
  return p
}

function score(home, args, { env = {}, rollout = 'demo' } = {}) {
  const r = spawnSync('python3', ['-B', SCORE, '--rollout', rollout, ...args], { encoding: 'utf8', cwd: home, env: baseEnv(home, env) })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json: r.status === 0 && r.stdout ? JSON.parse(r.stdout) : null }
}

function scored(home, args, opts) {
  const r = score(home, args, opts)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stderr, /^score: \S+: .*\n$/, 'one summary line on stderr')
  return r.json
}

// Every proposal and withheld entry keeps its sign: sign(to - from) == direction (a proposal) and to == ranAt + direction.
function signsHold(out) {
  for (const p of out.proposals) {
    assert.equal(Math.sign(p.to - p.from), p.direction, `${p.id}: sign(to - from) is its direction`)
    assert.equal(p.to, p.ranAt + p.direction, `${p.id}: to = ranAt + direction`)
  }
  for (const w of out.withheld) {
    assert.equal(w.to, w.ranAt + w.direction, `${w.id}: to = ranAt + direction`)
    assert.ok(Math.sign(w.to - w.from) !== w.direction || /Guardrail|lane \d+% busy/.test(w.reason), `${w.id}: withheld for a reason`)
  }
}

const has = (list, re) => list.some((x) => re.test(x))

// ---- 1. a Slot-bound run ------------------------------------------------------------------------------------

// Ceiling 3. Slots: a 00-02, b 00-03, c 00-04, d 02-05, e 03-05:30, f 04-06 (full 00:00-05:00). Each integrates for
// 20 min as its Slot frees; f takes the lane at 06:00 and holds it to 11:00, through a soft pause (06:30-08:30) and a
// merge hold with no Slot open (09:00-11:00). Running: 00:00-06:30 and 08:30-09:00 = 7 h.
function slotBound() {
  return byTs([
    ...life('a', { from: at('00:00'), to: at('02:00'), c: 3, lane: [at('02:00'), at('02:20')] }),
    ...life('b', { from: at('00:00'), to: at('03:00'), c: 3, lane: [at('03:00'), at('03:20')] }),
    ...life('c', { from: at('00:00'), to: at('04:00'), c: 3, lane: [at('04:00'), at('04:20')] }),
    ...life('d', { from: at('02:00'), to: at('05:00'), c: 3, lane: [at('05:00'), at('05:20')] }),
    ...life('e', { from: at('03:00'), to: at('05:30'), c: 3, lane: [at('05:30'), at('05:50')] }),
    ...life('f', { from: at('04:00'), to: at('06:00'), c: 3, lane: [at('06:00'), at('11:00')] }),
    [at('05:00'), 'idle-slots', null, { reason: 'queue-tail', free: 1, settings: S(3) }],
    [at('06:00'), 'idle-slots', null, { reason: 'pause-drain', free: 3, settings: S(3) }],
    [at('06:30'), 'paused', null, { mode: 'soft' }],
    [at('08:30'), 'resumed', null, {}],
    [at('09:00'), 'hold-started', 'f', { hold: 'merge' }],
    [at('11:00'), 'hold-ended', 'f', { hold: 'merge' }],
  ])
}

test('slot-bound: running time leaves out the pause and the hold, and the ceiling is proposed one up', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', slotBound())
  const out = scored(home, ['--until', at('12:00'), '--settings', writeSettings(home, { parallel_ceiling: 3 }), '--note', writeNote(home, { parallel_ceiling: 3, captured: '2026-10-04' })])
  assert.equal(out.window.since, Z(at('00:00')), 'the default --since is the first slot-taken')
  assert.equal(out.window.until, Z(at('12:00')))
  assert.equal(out.window.activeStart, Z(at('00:00')))
  assert.equal(out.window.activeEnd, Z(at('09:00')), 'the last active instant, not --until')
  assert.equal(out.window.partial, false)
  assert.equal(out.runningTime.hours, 7)
  assert.deepEqual(out.runningTime.excludedHours, { 'hold-merge': 2, idle: 1, paused: 2 })
  assert.deepEqual(out.runningTime.excluded.map((e) => [e.kind, e.start, e.end]), [
    ['paused', Z(at('06:30')), Z(at('08:30'))], ['hold-merge', Z(at('09:00')), Z(at('11:00'))], ['idle', Z(at('11:00')), Z(at('12:00'))]])
  assert.equal(out.merges.count, 6)
  assert.equal(out.throughput, 0.857)
  assert.equal(out.slots.ceiling, 3)
  assert.deepEqual(out.slots.ceilingSteps, [{ at: Z(at('00:00')), value: 3 }], 'one entry: the ceiling never changed')
  assert.equal(out.slots.fullShare, 0.7143)
  assert.equal(out.slots.utilisation, 0.7857)
  assert.equal(out.slots.capacityHours, 21)
  assert.deepEqual(out.slots.idleHours, { 'pause-drain': 1.5, 'queue-tail': 1.5, unexplained: 1.5 }, 'markers label their idle span; an unmarked one is unexplained')
  assert.equal(out.lane.busyShare, 0.381)
  assert.equal(out.lane.integrations, 6)
  assert.equal(out.lane.waitsClimbing, false)
  assert.equal(out.binding.constraint, 'slot-bound')
  assert.deepEqual(out.headline, { throughput: 0.857, runningHours: 7, merges: 6, tokensPerMerge: 100000, setAsideRate: 0, conflictRate: 0, quotaStalls: 0,
    handsOffRate: 0.8333, quality: null, reviewChurn: null }, 'f\'s merge hold is an act: 5 of 6 hands-off')
  assert.equal(out.proposals.length, 1)
  const [p] = out.proposals
  assert.deepEqual([p.id, p.key, p.from, p.to, p.ranAt, p.ranAtCause, p.rule, p.direction, p.agreeing], ['p1', 'parallel_ceiling', 3, 4, 3, null, 'slot-bound-raise', 1, 0])
  assert.match(p.evidence, /^Slot-bound: Slots full 71% of 7\.0 running h at ceiling 3; lane 38% busy/)
  assert.ok(p.evidence.length <= 300)
  assert.deepEqual(out.withheld, [])
  assert.ok(has(out.flags, /no baseline/), 'the first Reflection on a repo has no baseline')
  signsHold(out)
})

// ---- 1b. a run the Trickle held (p28-6) ----------------------------------------------------------------------

// Ceiling 4. a runs 00:00-02:00 with a hold-trickle marker (free 3) at 00:00; no Slot is open 02:00-03:00, the lead
// re-checking at each tick (markers at 02:00, 02:20, 02:40, free 4); b runs 03:00-05:00 with a marker at 03:00.
// `reason` swaps every marker's reason; `drop` leaves out the 02:20 and 02:40 ticks.
function trickleHeld({ reason = 'hold-trickle', drop = false } = {}) {
  const mark = (hm, free) => [at(hm), 'idle-slots', null, { reason, free, settings: S(4) }]
  return byTs([
    ...life('a', { from: at('00:00'), to: at('02:00'), c: 4 }),
    ...life('b', { from: at('03:00'), to: at('05:00'), c: 4 }),
    mark('00:00', 3), mark('02:00', 4), ...(drop ? [] : [mark('02:20', 4), mark('02:40', 4)]), mark('03:00', 3),
  ])
}

// `next`'s idle-slots marker at every 20-min tick in [from, to), minutes after 00:00, while a Slot is free.
const hmOf = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
function ticks(from, to, reason, free, c) {
  const out = []
  for (let m = from; m < to; m += 20) out.push([at(hmOf(m)), 'idle-slots', null, { reason, free, settings: S(c) }])
  return out
}

test('trickle-bound: no-Slot-open time held by the Trickle scores as hold-trickle and binds', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', trickleHeld())
  const out = scored(home, ['--until', at('05:00'), '--settings', writeSettings(home, { parallel_ceiling: 4 })])
  assert.deepEqual(out.runningTime.excludedHours, { 'hold-trickle': 1 })
  assert.deepEqual(out.runningTime.excluded.map((e) => [e.kind, e.start, e.end]), [['hold-trickle', Z(at('02:00')), Z(at('03:00'))]])
  assert.match(out.runningTime.excluded[0].why, /Trickle.*not Lachy's/)
  assert.equal(out.runningTime.hours, 4)
  assert.equal(out.slots.idleHours['hold-trickle'], 12, '3 free Slots x 4 running h')
  assert.equal(out.binding.constraint, 'trickle-bound')
  assert.equal(out.binding.why, 'the Mac-wide cap kept Slots free 100% of the time (running time plus 1 h with no Slot open; Slot time it held: the Trickle 16 h, the Away cap 0 h)')
  assert.ok(has(out.flags, /^trickle-bound: no rollout key moves this \(the Trickle is the Mac-wide cap in ~\/\.config\/thread\/away\.json\)$/))
  assert.ok(has(out.flags, /^throughput: read under the Mac-wide cap \(trickle-bound\): .* not at the ceiling 4$/))
  assert.deepEqual(out.proposals, [], 'no slot-bound raise')
  assert.deepEqual(out.withheld, [])
  assert.equal(out.thresholds.trickleBound, 0.5)
  assert.equal(out.thresholds.holdMarkerSpanMinutes, 40)
})

// A day run the Trickle held with its Slots open at the Trickle's room, every tick marking hold-trickle: the cap left
// (ceiling - Trickle) of the ceiling free, so against Slot capacity it held only 33%, 40% (with a queue tail) and 25%.
// Read by time, as slot-bound's full share, it kept a Slot free 100%, 80% and 100% of the run.
test('trickle-bound: a day run the Trickle held with Slots open binds, read by time and not by Slot capacity', (t) => {
  const two = (to, c) => [...life('a', { from: at('00:00'), to: at('04:00'), c }), ...life('b', { from: at('00:00'), to: at(to), c })]
  const cases = [
    { name: 'ceiling 3 at Trickle 2', c: 3, until: '04:00', ev: [...two('04:00', 3), ...ticks(0, 240, 'hold-trickle', 1, 3)],
      idle: { 'hold-trickle': 4 }, capacity: 12, share: 100, trickle: 4 },
    { name: 'ceiling 4 at Trickle 2, then a one-hour queue tail', c: 4, until: '05:00',
      ev: [...two('05:00', 4), ...ticks(0, 240, 'hold-trickle', 2, 4), ...ticks(240, 300, 'queue-tail', 3, 4)],
      idle: { 'hold-trickle': 8, 'queue-tail': 3 }, capacity: 20, share: 80, trickle: 8 },
    { name: 'ceiling 4 at a Trickle of 3', c: 4, until: '04:00',
      ev: [...two('04:00', 4), ...life('c', { from: at('00:00'), to: at('04:00'), c: 4 }), ...ticks(0, 240, 'hold-trickle', 1, 4)],
      idle: { 'hold-trickle': 4 }, capacity: 16, share: 100, trickle: 4 },
  ]
  for (const k of cases) {
    const home = tmpHome(t)
    emitAll(home, 'demo', byTs(k.ev))
    const out = scored(home, ['--until', at(k.until), '--settings', writeSettings(home, { parallel_ceiling: k.c })])
    assert.deepEqual(out.runningTime.excluded, [], `${k.name}: a Slot open throughout`)
    assert.deepEqual(out.slots.idleHours, k.idle, k.name)
    assert.equal(out.slots.capacityHours, k.capacity, k.name)
    assert.equal(out.binding.constraint, 'trickle-bound', k.name)
    assert.equal(out.binding.why, `the Mac-wide cap kept Slots free ${k.share}% of the time (running time plus 0 h with no Slot open; Slot time it held: the Trickle ${k.trickle} h, the Away cap 0 h)`, k.name)
    assert.deepEqual(out.proposals, [], `${k.name}: no rollout key moves it`)
  }
})

test('trickle-bound controls: a marker labels 40 min at most; dependency markers are no Trickle; the Away cap binds, Heat does not', (t) => {
  const settings = (home) => ['--until', at('05:00'), '--settings', writeSettings(home, { parallel_ceiling: 4 })]
  {
    const home = tmpHome(t)
    emitAll(home, 'demo', trickleHeld({ drop: true }))
    const out = scored(home, settings(home))
    assert.deepEqual(out.runningTime.excluded.map((e) => [e.kind, e.start, e.end]), [
      ['hold-trickle', Z(at('02:00')), Z(at('02:40'))], ['idle', Z(at('02:40')), Z(at('03:00'))]], 'a silent lead past the span reads idle')
  }
  {
    const home = tmpHome(t)
    emitAll(home, 'demo', trickleHeld({ reason: 'dependency' }))
    const out = scored(home, settings(home))
    assert.deepEqual(out.runningTime.excludedHours, { idle: 1 })
    assert.equal(out.binding.constraint, 'dependency-bound')
  }
  {
    const home = tmpHome(t)
    emitAll(home, 'demo', trickleHeld({ reason: 'hold-away-cap' }))
    const out = scored(home, settings(home))
    assert.deepEqual(out.runningTime.excludedHours, { 'hold-away-cap': 1 })
    assert.equal(out.binding.constraint, 'trickle-bound')
    assert.match(out.binding.why, /^the Mac-wide cap kept Slots free 100% of the time \(running time plus 1 h with no Slot open; Slot time it held: the Trickle 0 h, the Away cap 16 h\)$/)
  }
  {
    const home = tmpHome(t)
    emitAll(home, 'demo', trickleHeld({ reason: 'hold-heat' }))
    const out = scored(home, settings(home))
    assert.deepEqual(out.runningTime.excludedHours, { 'hold-heat': 1 })
    assert.match(out.runningTime.excluded[0].why, /Heat hold/)
    assert.notEqual(out.binding.constraint, 'trickle-bound')
    assert.ok(!has(out.flags, /^trickle-bound/))
  }
  {
    // the head of a no-Slot stretch before its first Mac-wide marker (within the span) takes that marker's label
    const home = tmpHome(t)
    emitAll(home, 'demo', byTs([
      ...life('a', { from: at('00:00'), to: at('02:00'), c: 4 }),
      ...life('b', { from: at('03:00'), to: at('05:00'), c: 4 }),
      [at('02:10'), 'idle-slots', null, { reason: 'hold-trickle', free: 4, settings: S(4) }],
      [at('02:30'), 'idle-slots', null, { reason: 'hold-trickle', free: 4, settings: S(4) }],
    ]))
    const out = scored(home, settings(home))
    assert.deepEqual(out.runningTime.excluded.map((e) => [e.kind, e.start, e.end]), [
      ['hold-trickle', Z(at('02:00')), Z(at('03:00'))]], 'back-filled from the stretch start, the last marker spanning to b')
  }
  for (const [before, want] of [
    // ... unless another reason is in force there: the queue-tail marked at 01:00 still holds when a stops at 02:00,
    // so only the hold-trickle marker's own span reads as the Trickle (and adds nothing to its held time)
    ['queue-tail', [['idle', Z(at('02:00')), Z(at('02:30'))], ['hold-trickle', Z(at('02:30')), Z(at('03:00'))]]],
    // ... while the same Mac-wide reason in force there back-fills
    ['hold-trickle', [['hold-trickle', Z(at('02:00')), Z(at('03:00'))]]],
  ]) {
    const home = tmpHome(t)
    emitAll(home, 'demo', byTs([
      ...life('a', { from: at('00:00'), to: at('02:00'), c: 4 }),
      ...life('b', { from: at('03:00'), to: at('05:00'), c: 4 }),
      [at('01:00'), 'idle-slots', null, { reason: before, free: 3, settings: S(4) }],
      [at('02:30'), 'idle-slots', null, { reason: 'hold-trickle', free: 4, settings: S(4) }],
    ]))
    const out = scored(home, settings(home))
    assert.deepEqual(out.runningTime.excluded.map((e) => [e.kind, e.start, e.end]), want, `${before} in force at the stop`)
  }
  {
    // the cap kept a Slot free half the time (three Slots at a Trickle of 3, 00:00-03:00, of 6 h), but the dependency
    // waits after it left 9 Slot-hours idle to the cap's 3: the larger reason binds, never the Trickle
    const home = tmpHome(t)
    emitAll(home, 'demo', byTs([
      ...['a', 'b', 'c'].flatMap((s) => life(s, { from: at('00:00'), to: at('03:00'), c: 4 })),
      ...life('d', { from: at('03:00'), to: at('06:00'), c: 4 }),
      ...ticks(0, 180, 'hold-trickle', 1, 4), ...ticks(180, 360, 'dependency', 3, 4),
    ]))
    const out = scored(home, ['--until', at('06:00'), '--settings', writeSettings(home, { parallel_ceiling: 4 })])
    assert.deepEqual(out.slots.idleHours, { dependency: 9, 'hold-trickle': 3 })
    assert.equal(out.binding.constraint, 'dependency-bound')
    assert.ok(!has(out.flags, /^trickle-bound/))
  }
  {
    // a run the Trickle held with no Slot ever open: the window starts at its first line, nothing runs, and the cap
    // held all of its time
    const home = tmpHome(t)
    emitAll(home, 'demo', ticks(0, 60, 'hold-trickle', 4, 4))
    const out = scored(home, ['--until', at('01:00'), '--settings', writeSettings(home, { parallel_ceiling: 4 })])
    assert.equal(out.runningTime.hours, 0)
    assert.deepEqual(out.runningTime.excludedHours, { 'hold-trickle': 1 })
    assert.equal(out.throughput, null)
    assert.equal(out.binding.constraint, 'trickle-bound')
  }
})

// ---- 2. a lane-bound run ------------------------------------------------------------------------------------

// Ceiling 4. Six tasks, each holding the lane 1.5 h back to back from 01:00 to 10:00; the ready -> lane waits climb
// 0, 30, 60, 120, 180, 240 min. Slots carry 15 of 40 Slot-hours.
test('lane-bound: the lane is the binding constraint and no key is proposed', (t) => {
  const home = tmpHome(t)
  const spec = [['t1', '00:00', '01:00', '01:00', '02:30'], ['t2', '00:00', '02:00', '02:30', '04:00'], ['t3', '00:00', '03:00', '04:00', '05:30'],
    ['t4', '00:00', '03:30', '05:30', '07:00'], ['t5', '01:00', '04:00', '07:00', '08:30'], ['t6', '02:00', '04:30', '08:30', '10:00']]
  emitAll(home, 'demo', byTs(spec.flatMap(([s, a, b, l1, l2]) => life(s, { from: at(a), to: at(b), c: 4, lane: [at(l1), at(l2)] }))))
  const out = scored(home, ['--until', at('10:00'), '--settings', writeSettings(home, { parallel_ceiling: 4 })])
  assert.equal(out.runningTime.hours, 10)
  assert.equal(out.lane.busyShare, 0.9)
  assert.deepEqual(out.lane.waitsMinutes, [0, 30, 60, 120, 180, 240])
  assert.equal(out.lane.waitFirstThirdMean, 15)
  assert.equal(out.lane.waitLastThirdMean, 210)
  assert.equal(out.lane.waitsClimbing, true)
  assert.equal(out.slots.utilisation, 0.375)
  assert.equal(out.binding.constraint, 'lane-bound')
  assert.deepEqual(out.proposals, [])
  assert.deepEqual(out.withheld, [])
  assert.ok(has(out.flags, /no key moves this/))
  assert.equal(out.throughput, 0.6)
  assert.deepEqual([out.guardrails.throughput.tasks, out.guardrails.throughput.allowanceHours, out.guardrails.throughput.breached], [6, 9, true],
    '10 running h against 1.5 h for each of 6 tasks')
})

// Ceiling 2, Slots full 00:00-10:00 and the lane held 03:00-10:00 (70% of running time, waits flat): Slot-bound,
// and the raise is shown but withheld, because the extra Slot's work would queue on the lane.
test('slot-bound with the lane 60-80% busy: the raise is withheld with the lane\'s share, never silently dropped', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', byTs([
    ...life('a', { from: at('00:00'), to: at('03:00'), c: 2, lane: [at('03:00'), at('06:00')] }),
    ...life('b', { from: at('00:00'), to: at('06:00'), c: 2, lane: [at('06:00'), at('10:00')] }),
    ...life('c', { from: at('03:00'), to: at('10:00'), c: 2, merged: false }),
    ...life('d', { from: at('06:00'), to: at('10:00'), c: 2, merged: false }),
  ]))
  const out = scored(home, ['--until', at('10:00'), '--settings', writeSettings(home, { parallel_ceiling: 2 })])
  assert.equal(out.runningTime.hours, 10)
  assert.equal(out.lane.busyShare, 0.7)
  assert.equal(out.lane.waitsClimbing, false)
  assert.equal(out.binding.constraint, 'slot-bound')
  assert.deepEqual(out.proposals, [])
  assert.equal(out.withheld.length, 1)
  const [w] = out.withheld
  assert.deepEqual([w.key, w.from, w.to, w.ranAt, w.rule, w.direction], ['parallel_ceiling', 2, 3, 2, 'slot-bound-raise', 1])
  assert.equal(w.reason, 'lane 70% busy, at or above 60%: a raise would queue on the Integration lane')
  signsHold(out)
})

// ---- 3. direction and cause -------------------------------------------------------------------------------------

test('(a) rollouts.toml edited after the run started, already past the evidence: withheld', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', byTs(saturated(3)))
  const toml = writeToml(home, at('01:00'))
  const out = scored(home, ['--until', at('06:00'), '--settings', writeSettings(home, { parallel_ceiling: 5 }, { file: toml })])
  assert.equal(out.binding.constraint, 'slot-bound')
  assert.deepEqual(out.proposals, [])
  assert.equal(out.withheld.length, 1)
  const [w] = out.withheld
  assert.deepEqual([w.key, w.from, w.to, w.ranAt], ['parallel_ceiling', 5, 4, 3])
  assert.equal(w.ranAtCause, 'rollouts.toml was edited after the run started')
  assert.equal(w.reason, 'rollouts.toml already at 5, at or past this run\'s evidence (ran at 3 → 4); rollouts.toml was edited after the run started')
  signsHold(out)
})

test('(b) a rollout-note override (ran at 5, rollouts.toml at 3 since before scheduling): proposed 3 → 6', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', byTs(saturated(5)))
  const toml = writeToml(home, '2026-10-01T00:00:00Z')
  const out = scored(home, ['--until', at('06:00'), '--settings', writeSettings(home, { parallel_ceiling: 3 }, { file: toml }), '--note', writeNote(home, { parallel_ceiling: 5, captured: '2026-10-04' })])
  assert.equal(out.withheld.length, 0)
  const [p] = out.proposals
  assert.deepEqual([p.key, p.from, p.to, p.ranAt, p.direction], ['parallel_ceiling', 3, 6, 5, 1])
  assert.equal(p.ranAtCause, 'ran at 5 by a rollout-note override; rollouts.toml has said 3 since before this rollout was scheduled')
  signsHold(out)
})

test('(c) a mid-run ceiling change: ran at the time-weighted value, flagged with the split', (t) => {
  const home = tmpHome(t)
  // ceiling 3 from 00:00 (three Slots to 07:00), then 5 from 07:00 (five Slots to 10:00)
  const ev = []
  for (const s of ['a', 'b', 'c']) ev.push(...life(s, { from: at('00:00'), to: at('07:00'), c: 3, lane: [at('07:00'), at('07:00')] }))
  for (const s of ['d', 'e', 'f', 'g', 'h']) ev.push(...life(s, { from: at('07:00'), to: at('10:00'), c: 5, merged: false }))
  emitAll(home, 'demo', byTs(ev))
  const out = scored(home, ['--until', at('10:00'), '--settings', writeSettings(home, { parallel_ceiling: 3 })])
  assert.equal(out.runningTime.hours, 10)
  assert.equal(out.slots.ceiling, 3, '7 h at 3 against 3 h at 5')
  assert.deepEqual(out.slots.ceilingSteps, [{ at: Z(at('00:00')), value: 3 }, { at: Z(at('07:00')), value: 5 }], 'the changes only')
  assert.ok(has(out.flags, new RegExp(`^ceiling changed mid-window 3 → 5 at ${Z(at('07:00')).replace(/\./g, '\\.')} \\(a note or task override\\): split with --since/--until$`)))
  const [p] = out.proposals
  assert.deepEqual([p.from, p.to, p.ranAt, p.ranAtCause], [3, 4, 3, null])
  signsHold(out)
})

test('(c) the ran-at value differs from rollouts.toml after a mid-run change: the cause names the change', (t) => {
  const home = tmpHome(t)
  const ev = []
  for (const s of ['a', 'b', 'c']) ev.push(...life(s, { from: at('00:00'), to: at('07:00'), c: 3, lane: [at('07:00'), at('07:00')] }))
  for (const s of ['d', 'e', 'f', 'g', 'h']) ev.push(...life(s, { from: at('07:00'), to: at('10:00'), c: 5, merged: false }))
  emitAll(home, 'demo', byTs(ev))
  const out = scored(home, ['--until', at('10:00'), '--settings', writeSettings(home, { parallel_ceiling: 2 })])
  const [p] = out.proposals
  assert.deepEqual([p.from, p.to, p.ranAt], [2, 4, 3])
  assert.equal(p.ranAtCause, `changed mid-window 3 → 5 at ${Z(at('07:00'))} (a note or task override)`)
})

test('(d) a prior Tuning already moved the key: withheld with its id', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', byTs(saturated(3)))
  emitAll(home, 'older-run', [[at('02:00'), 'tuning', null, {
    id: 't-prior', repo: 'o/r', window: { since: D(4, '00:00'), until: D(4, '10:00'), activeStart: D(4, '00:00'), activeEnd: D(4, '09:00'), partial: false },
    scores: { throughput: 1, runningHours: 9, merges: 9, tokensPerMerge: null, setAsideRate: 0, conflictRate: 0, quotaStalls: 0, handsOffRate: 1, quality: null, reviewChurn: null },
    applied: [{ key: 'parallel_ceiling', from: 3, to: 4, ranAt: 3, rule: 'slot-bound-raise', evidence: 'Slot-bound', agreeing: 0 }],
  }]])
  const out = scored(home, ['--until', at('06:00'), '--settings', writeSettings(home, { parallel_ceiling: 4 })])
  const [w] = out.withheld
  assert.deepEqual([w.from, w.to, w.ranAt, w.agreeing], [4, 4, 3, 1])
  assert.equal(w.ranAtCause, `Tuning t-prior moved it on ${Z(at('02:00'))}`)
  assert.equal(w.reason, `rollouts.toml already at 4, at or past this run's evidence (ran at 3 → 4); Tuning t-prior moved it on ${Z(at('02:00'))}`)
  assert.deepEqual(out.proposals, [])
})

test('(e) rollouts.toml changed between the captured day and the first Slot: the cause is unclear', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', byTs(saturated(5)))
  const toml = writeToml(home, D(4, '12:00')) // after captured 2026-10-04's Melbourne midnight (03T14:00Z), before Mon 00:00Z
  const out = scored(home, ['--until', at('06:00'), '--settings', writeSettings(home, { parallel_ceiling: 3 }, { file: toml }), '--note', writeNote(home, { parallel_ceiling: 5, captured: '2026-10-04' })])
  const [p] = out.proposals
  assert.deepEqual([p.from, p.to, p.ranAt], [3, 6, 5])
  assert.equal(p.ranAtCause, 'unclear: rollouts.toml changed around schedule time')
})

test('(e) the rollout note now differs from what the run ran at: named', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', byTs(saturated(5)))
  const out = scored(home, ['--until', at('06:00'), '--settings', writeSettings(home, { parallel_ceiling: 3 }), '--note', writeNote(home, { parallel_ceiling: 6, captured: '2026-10-04' })])
  assert.equal(out.proposals[0].ranAtCause, 'the rollout note now says 6; the run ran at 5')
})

test('(f) quota-bound at 4 with rollouts.toml at 4: proposed 4 → 3', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', byTs([...saturated(4), [at('02:00'), 'quota-stall', null, { stage: 'implement', detail: 'usage limit' }]]))
  const out = scored(home, ['--until', at('06:00'), '--settings', writeSettings(home, { parallel_ceiling: 4 })])
  assert.equal(out.binding.constraint, 'quota-bound')
  const [p] = out.proposals
  assert.deepEqual([p.key, p.from, p.to, p.ranAt, p.direction, p.rule], ['parallel_ceiling', 4, 3, 4, -1, 'quota-bound-lower'])
  assert.equal(out.guardrails.quotaStalls.breached, true, 'a stall breaches the absolute bound with no baseline')
  assert.equal(out.guardrails.throughput.breached, false, '4.667 running h against 6 h for 4 tasks')
  assert.deepEqual([p.serves, p.risks, p.trade, p.caution], [['quotaStalls'], ['throughput'], null, null], 'no Guardrail it risks is breached: no caution')
  signsHold(out)
})

test('(f) a lower is never withheld by a Guardrail: with Throughput breached it stays proposed, with a caution for Lachy', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', byTs([...saturated(4), [at('02:00'), 'quota-stall', null, { stage: 'implement', detail: 'usage limit' }]]))
  const out = scored(home, ['--until', at('06:00'), '--settings', writeSettings(home, { parallel_ceiling: 4 }, { guardrails: { hours_per_task: 1.0 } })])
  assert.equal(out.guardrails.throughput.breached, true, '4.667 running h against 4 h')
  assert.deepEqual(out.withheld, [])
  const [p] = out.proposals
  assert.equal(p.rule, 'quota-bound-lower')
  assert.match(p.caution, /^risks throughput, breached \(4\.667 running h against 4\.0 h, <= 1 running h per task\): a Guardrail against a Guardrail, Lachy decides$/)
  signsHold(out)
})

test('(g) quota-bound at 5 with rollouts.toml at 3: withheld, already past 5 - 1', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', byTs([...saturated(5), [at('02:00'), 'quota-stall', null, {}]]))
  const out = scored(home, ['--until', at('06:00'), '--settings', writeSettings(home, { parallel_ceiling: 3 }), '--note', writeNote(home, { parallel_ceiling: 5, captured: '2026-10-04' })])
  assert.deepEqual(out.proposals, [])
  const [w] = out.withheld
  assert.deepEqual([w.from, w.to, w.ranAt, w.direction], [3, 4, 5, -1])
  assert.match(w.reason, /^rollouts\.toml already at 3, at or past this run's evidence \(ran at 5 → 4\); ran at 5 by a rollout-note override/)
  signsHold(out)
})

test('(h) quota-bound at ceiling 1: the drop to 0 is dropped and flagged', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', byTs([...saturated(1), [at('02:00'), 'quota-stall', null, {}]]))
  const out = scored(home, ['--until', at('06:00'), '--settings', writeSettings(home, { parallel_ceiling: 1 })])
  assert.deepEqual(out.proposals, [])
  assert.deepEqual(out.withheld, [])
  assert.ok(has(out.flags, /^quota-bound-lower: parallel_ceiling would drop to 0 \(ran at 1\): dropped$/))
})

test('(i) round caps: the most common slot-taken value is ran-at, and a task override is flagged', (t) => {
  const home = tmpHome(t)
  const caps = [4, 4, 6]
  const ev = saturated(3, { settings: (i) => S(3, { max_review_rounds: caps[i] }) })
  ev.push([at('03:00'), 'set-aside', 't1', { stage: 'review', reasonClass: 'review-rounds', setAsideAt: 'run' }])
  ev.push([at('03:30'), 'set-aside', 't2', { stage: 'review', reasonClass: 'review-rounds', setAsideAt: 'run' }])
  emitAll(home, 'demo', byTs(ev))
  const out = scored(home, ['--until', at('06:00'), '--settings', writeSettings(home, { parallel_ceiling: 3, max_review_rounds: 4 })])
  const p = out.proposals.find((x) => x.key === 'max_review_rounds')
  assert.deepEqual([p.from, p.to, p.ranAt, p.rule, p.ranAtCause], [4, 5, 4, 'review-rounds-raise', null])
  assert.ok(has(out.flags, /^max_review_rounds: 1 of 3 tasks ran with a task override$/))
  // Throughput sits exactly on its bound here (4.5 running h for 3 tasks at 1.5 h each): compared in ms and strictly
  // greater, so not breached. This test and the next two rely on that.
  assert.deepEqual(out.guardrails.throughput, { value: 0.667, runningHours: 4.5, tasks: 3, allowanceHours: 4.5,
    bound: '<= 1.5 running h per task', baseline: null, breached: false })
  assert.deepEqual([p.serves, p.trade, p.caution], [['handsOffRate'], null, null], 'Quality is unscored: no trade yet')
  assert.ok(p.risks.includes('quality') && p.risks.includes('throughput') && p.risks.includes('reviewChurn'), JSON.stringify(p.risks))
  for (const e of [...out.proposals, ...out.withheld]) {
    for (const k of ['serves', 'risks', 'trade', 'caution']) assert.ok(k in e, `${e.id} carries ${k}`)
  }
  signsHold(out)
})

test('(i) Throughput past its bound withholds the round raise it risks, never the slot-bound raise it serves', (t) => {
  const home = tmpHome(t)
  const caps = [4, 4, 6]
  const ev = saturated(3, { settings: (i) => S(3, { max_review_rounds: caps[i] }) })
  ev.push([at('03:00'), 'set-aside', 't1', { stage: 'review', reasonClass: 'review-rounds', setAsideAt: 'run' }])
  ev.push([at('03:30'), 'set-aside', 't2', { stage: 'review', reasonClass: 'review-rounds', setAsideAt: 'run' }])
  emitAll(home, 'demo', byTs(ev))
  const out = scored(home, ['--until', at('06:00'), '--settings', writeSettings(home, { parallel_ceiling: 3, max_review_rounds: 4 }, { guardrails: { hours_per_task: 1.0 } })])
  assert.equal(out.guardrails.throughput.breached, true, '4.5 running h against 3 h')
  const w = out.withheld.find((x) => x.rule === 'review-rounds-raise')
  assert.match(w.reason, /^a raise while a Guardrail is breached: throughput 4\.5 running h against 3\.0 h \(<= 1 running h per task, 3 task\(s\)\)$/)
  assert.deepEqual(out.proposals.map((x) => x.rule), ['slot-bound-raise'], 'the slot-bound raise serves Throughput, so it is never withheld by it')
  signsHold(out)
})

test('(i) a round cap whose ran-at differs from rollouts.toml by a task spread names the spread', (t) => {
  const home = tmpHome(t)
  const caps = [4, 4, 6]
  const ev = saturated(3, { settings: (i) => S(3, { max_plan_rounds: caps[i] }) })
  ev.push([at('03:00'), 'set-aside', 't1', { stage: 'plan', reasonClass: 'plan-rejected', setAsideAt: 'run' }])
  ev.push([at('03:30'), 'set-aside', 't2', { stage: 'plan', reasonClass: 'plan-rejected', setAsideAt: 'run' }])
  emitAll(home, 'demo', byTs(ev))
  const out = scored(home, ['--until', at('06:00'), '--settings', writeSettings(home, { parallel_ceiling: 3, max_plan_rounds: 3 })])
  const p = out.proposals.find((x) => x.key === 'max_plan_rounds')
  assert.deepEqual([p.from, p.to, p.ranAt, p.rule, p.ranAtCause], [3, 5, 4, 'plan-rejected-raise', '1 of 3 tasks ran with a task override'])
})

test('(i) needs-human set-asides (p16-3, a stop on a question) raise no round cap', (t) => {
  // reconcile-rollout.py classes a review or plan judge's question stop needs-human, not review-rounds or
  // plan-rejected: another round can never answer a question, so two of each must propose nothing on the caps.
  const home = tmpHome(t)
  const ev = saturated(3, { settings: () => S(3, { max_review_rounds: 4, max_plan_rounds: 3 }) })
  ev.push([at('03:00'), 'set-aside', 't1', { stage: 'review', reasonClass: 'needs-human', setAsideAt: 'run' }])
  ev.push([at('03:10'), 'set-aside', 't2', { stage: 'review', reasonClass: 'needs-human', setAsideAt: 'run' }])
  ev.push([at('03:20'), 'set-aside', 't3', { stage: 'plan', reasonClass: 'needs-human', setAsideAt: 'run' }])
  ev.push([at('03:30'), 'set-aside', 't1', { stage: 'plan', reasonClass: 'needs-human', setAsideAt: 'run' }])
  emitAll(home, 'demo', byTs(ev))
  const out = scored(home, ['--until', at('06:00'), '--settings', writeSettings(home, { parallel_ceiling: 3, max_review_rounds: 4, max_plan_rounds: 3 })])
  const rules = [...out.proposals, ...out.withheld].map((x) => x.rule)
  assert.ok(!rules.includes('review-rounds-raise') && !rules.includes('plan-rejected-raise'), JSON.stringify(rules))
  assert.ok(![...out.proposals, ...out.withheld].some((x) => x.key === 'max_review_rounds' || x.key === 'max_plan_rounds'))
  assert.equal(out.headline.setAsideRate > 0, true, 'the four set-asides still count toward the set-aside rate')
})

// ---- 4. the baseline ----------------------------------------------------------------------------------------------

const SC = (over = {}) => ({ throughput: 1, runningHours: 4, merges: 4, tokensPerMerge: 100000, setAsideRate: 0.1, conflictRate: 0, quotaStalls: 0,
  handsOffRate: 0.8, quality: null, reviewChurn: null, ...over })
const tuningLine = (ts, id, window, { repo = 'o/r', scores = SC(), applied = [], voids } = {}) =>
  [ts, 'tuning', null, { id, repo, window: { since: window[0], until: window[1], activeStart: window[2], activeEnd: window[3], partial: window[4] ?? false }, scores, applied, ...(voids ? { voids } : {}) }, 'older-run']

// Two set-asides on a saturated(3) run: a set-aside rate of 2 / (3 closed + 3 Integrations) = 0.3333.
const withSetAsides = () => byTs([...saturated(3), [at('03:00'), 'set-aside', 't1', { stage: 'implement', reasonClass: 'blocked', setAsideAt: 'run' }],
  [at('03:30'), 'set-aside', 't2', { stage: 'implement', reasonClass: 'blocked', setAsideAt: 'run' }]])

test('baseline: the latest line ending before this run began, so a set-aside rise withholds the raise', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', withSetAsides())
  emitAll(home, 'x', [
    tuningLine(D(4, '21:00'), 't-base', [D(4, '10:00'), D(4, '21:00'), D(4, '10:00'), D(4, '20:00')], { scores: SC({ setAsideRate: 0.1 }) }),
    tuningLine(D(3, '21:00'), 't-older', [D(3, '10:00'), D(3, '21:00'), D(3, '10:00'), D(3, '20:00')], { scores: SC({ setAsideRate: 0.5 }) }),
    tuningLine(D(5, '04:00'), 't-overlap', [D(4, '22:00'), D(5, '04:00'), D(4, '22:00'), D(5, '03:00')], { scores: SC({ setAsideRate: 0.5 }) }),
  ])
  const out = scored(home, ['--until', at('06:00'), '--settings', writeSettings(home, { parallel_ceiling: 3 })])
  assert.equal(out.baseline.id, 't-base')
  assert.deepEqual([out.baseline.v, out.handsOff.baseline], [2, 0.8], 'a v2 line: its Hands-off rate is the baseline')
  assert.ok(!has(out.flags, /a v1 line/))
  assert.equal(out.headline.setAsideRate, 0.3333)
  assert.equal(out.guardrails.setAsideRate.baseline, 0.1)
  assert.equal(out.guardrails.setAsideRate.breached, true)
  assert.deepEqual(out.proposals, [])
  assert.match(out.withheld[0].reason, /^a raise while a Guardrail is breached: setAsideRate 0\.3333 \(baseline 0\.1, bound \+5 points\)$/)
  assert.ok(!has(out.flags, /no baseline/))
})

test('baseline: a late Reflection (its line stamped after the next run began) still serves, on its active span', (t) => {
  const home = tmpHome(t)
  // Run B starts Tue 09:00; run A was active until Mon 18:00 and its Reflection ran Tue 12:00.
  const shift = 33 * 3600e3 // Mon 00:00 -> Tue 09:00, the journals' startTime with it
  emitAll(home, 'demo', byTs(saturated(3, { prefix: 'b' }).map(([ts, kind, task, f]) =>
    [new Date(ms(ts) + shift).toISOString(), kind, task, 'startTime' in f ? { ...f, startTime: f.startTime + shift } : f])))
  emitAll(home, 'x', [tuningLine(D(6, '12:00'), 't-a', [D(5, '08:00'), D(6, '12:00'), D(5, '08:00'), D(5, '18:00')], { scores: SC({ setAsideRate: 0 }) })])
  const out = scored(home, ['--until', D(6, '16:00'), '--settings', writeSettings(home, { parallel_ceiling: 3 })])
  assert.equal(out.window.activeStart, Z(D(6, '09:00')))
  assert.equal(out.baseline.id, 't-a')
})

test('baseline: a partial line only when no complete one qualifies; activeEnd null never; another repo never', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', byTs(saturated(3)))
  emitAll(home, 'x', [
    tuningLine(D(4, '21:00'), 't-partial', [D(4, '10:00'), D(4, '21:00'), D(4, '10:00'), D(4, '21:00'), true]),
    tuningLine(D(4, '20:00'), 't-whole', [D(4, '08:00'), D(4, '20:00'), D(4, '08:00'), D(4, '19:00')]),
    tuningLine(D(4, '23:00'), 't-null', [D(4, '22:00'), D(4, '23:00'), null, null]),
    tuningLine(D(4, '23:30'), 't-other', [D(4, '22:00'), D(4, '23:30'), D(4, '22:00'), D(4, '23:00')], { repo: 'o/other' }),
  ])
  const settings = writeSettings(home, { parallel_ceiling: 3 })
  const out = scored(home, ['--until', at('06:00'), '--settings', settings])
  assert.equal(out.baseline.id, 't-whole', 'a complete line beats a later partial one')
  assert.ok(!has(out.flags, /partial Reflection/))

  const home2 = tmpHome(t)
  emitAll(home2, 'demo', byTs(saturated(3)))
  emitAll(home2, 'x', [
    tuningLine(D(4, '21:00'), 't-partial', [D(4, '10:00'), D(4, '21:00'), D(4, '10:00'), D(4, '21:00'), true]),
    tuningLine(D(4, '23:00'), 't-null', [D(4, '22:00'), D(4, '23:00'), null, null]),
  ])
  const out2 = scored(home2, ['--until', at('06:00'), '--settings', writeSettings(home2, { parallel_ceiling: 3 })])
  assert.equal(out2.baseline.id, 't-partial')
  assert.ok(has(out2.flags, /^baseline: only a partial Reflection's line qualifies \(t-partial\)/))

  const home3 = tmpHome(t)
  emitAll(home3, 'demo', byTs(saturated(3)))
  emitAll(home3, 'x', [tuningLine(D(4, '23:00'), 't-null', [D(4, '22:00'), D(4, '23:00'), null, null]),
    tuningLine(D(4, '23:30'), 't-other', [D(4, '22:00'), D(4, '23:30'), D(4, '22:00'), D(4, '23:00')], { repo: 'o/other' })])
  const out3 = scored(home3, ['--until', at('06:00'), '--settings', writeSettings(home3, { parallel_ceiling: 3 })])
  assert.equal(out3.baseline, null)
  assert.ok(has(out3.flags, /^no baseline/))
})

test('baseline: the repo matches ignoring case', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', byTs(saturated(3)))
  emitAll(home, 'x', [tuningLine(D(4, '21:00'), 't-upper', [D(4, '10:00'), D(4, '21:00'), D(4, '10:00'), D(4, '20:00')], { repo: 'O/R' })])
  const out = scored(home, ['--until', at('06:00'), '--repo-slug', 'o/r', '--settings', writeSettings(home, { parallel_ceiling: 3 }, { repo: null })])
  assert.equal(out.repo, 'o/r')
  assert.equal(out.baseline.id, 't-upper')
})

test('a voided line: its applied neither agrees nor causes, its scores still a baseline', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', byTs(saturated(3)))
  const applied = [{ key: 'parallel_ceiling', from: 3, to: 4, ranAt: 3, rule: 'slot-bound-raise', evidence: 'Slot-bound', agreeing: 0 }]
  const w = [D(4, '10:00'), D(4, '21:00'), D(4, '10:00'), D(4, '20:00')]
  emitAll(home, 'x', [
    tuningLine(D(4, '21:00'), 't-x', w, { applied }),
    tuningLine(D(4, '21:01'), 't-v', w, { voids: 't-x' }),
    tuningLine(at('02:00'), 't-y', [at('01:00'), at('02:00'), null, null], { applied }),
    tuningLine(at('02:01'), 't-yv', [at('01:00'), at('02:00'), null, null], { voids: 't-y' }),
  ])
  const out = scored(home, ['--until', at('06:00'), '--settings', writeSettings(home, { parallel_ceiling: 4 })])
  assert.ok(['t-x', 't-v'].includes(out.baseline.id), 'a voided line\'s scores still serve as the baseline')
  const [w0] = out.withheld
  assert.equal(w0.agreeing, 0, 'a voided applied never agrees')
  assert.notEqual(w0.ranAtCause, `Tuning t-y moved it on ${Z(at('02:00'))}`, 'a voided Tuning is never the cause')
  assert.equal(w0.ranAtCause, 'unclear: rollouts.toml changed around schedule time')
})

test('baseline: a v1 line (seven scores) still serves, flagged, with no Hands-off rate baseline', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', withSetAsides())
  // written by hand in run_record's line format: the writer now refuses seven scores
  const v1 = { v: 1, ts: Z(D(4, '21:00')), host: 'h', rollout: 'older-run', task: null, kind: 'tuning', id: 't-v1', repo: 'o/r',
    window: { since: Z(D(4, '10:00')), until: Z(D(4, '21:00')), activeStart: Z(D(4, '10:00')), activeEnd: Z(D(4, '20:00')), partial: false },
    scores: { throughput: 1, runningHours: 4, merges: 4, tokensPerMerge: 100000, setAsideRate: 0.1, conflictRate: 0, quotaStalls: 0 }, applied: [] }
  fs.mkdirSync(evDir(home), { recursive: true })
  fs.appendFileSync(path.join(evDir(home), 'tunings.jsonl'), JSON.stringify(v1) + '\n')
  const out = scored(home, ['--until', at('06:00'), '--settings', writeSettings(home, { parallel_ceiling: 3 })])
  assert.deepEqual([out.baseline.id, out.baseline.v], ['t-v1', 1])
  assert.ok(has(out.flags, /^baseline t-v1 is a v1 line: no Hands-off rate, Quality or Review churn baseline$/), out.flags.join('\n'))
  assert.equal(out.handsOff.baseline, null)
  assert.equal(out.guardrails.setAsideRate.breached, true, 'its old Guardrails still compare')
  assert.equal(out.guardrails.reviewChurn.baseline, null)
})

// ---- 6. the two headlines (p21-2, ADR 0037 d1) -------------------------------------------------------------------

// A task set aside at 01:00 and re-entered at 02:00 (a slot-taken start=hand-back), landing at 03:00: `between` are its
// [kind, fields] events at 01:30, after the set-aside and before the restart.
function handedBack(slug, between, stage = 'implement') {
  return [
    [at('00:00'), 'slot-taken', slug, { settings: S(11), start: 'start' }],
    [at('01:00'), 'slot-freed', slug, { outcome: 'set-aside' }],
    [at('01:00'), 'set-aside', slug, { stage, reasonClass: stage === 'gate' ? 'gate' : 'blocked', setAsideAt: stage === 'gate' ? 'gate' : 'run' }],
    ...between.map(([kind, f]) => [at('01:30'), kind, slug, f]),
    [at('02:00'), 'slot-taken', slug, { settings: S(11), start: 'hand-back' }],
    [at('03:00'), 'slot-freed', slug, { outcome: 'ready' }],
    [at('03:00'), 'merged', slug, { pr: 7 }],
  ]
}
// A task whose Slot runs 00:00-01:00 and lands at 01:10, `after` events between its Slot's end and the merge.
function landed(slug, after = []) {
  return [
    [at('00:00'), 'slot-taken', slug, { settings: S(11), start: 'start' }],
    [at('01:00'), 'slot-freed', slug, { outcome: 'ready' }],
    ...after.map(([hm, kind, f]) => [at(hm), kind, slug, f]),
    [at('01:10'), 'merged', slug, { pr: 7 }],
  ]
}

// Ten landed tasks, five with an act from Lachy, and one that never lands.
function handsOffRecord() {
  return byTs([
    ...landed('h01'),
    ...landed('h02', [['01:00', 'hold-started', { hold: 'merge' }], ['01:10', 'hold-ended', { hold: 'merge' }]]),
    ...handedBack('h03', [['answer-recorded', { answerKind: 'needs-you', form: 'hand-back', pr: false }], ['handed-back', { via: 'answer', arm: 'run' }]]),
    ...handedBack('h04', [['gate-signed', { standing: true, gates: 1 }]], 'gate'),
    ...handedBack('h05', [['handed-back', { via: 'descope', arm: 'run' }]], 'plan'),
    ...handedBack('h06', [['handed-back', { via: 'retry', arm: 'run' }]]),
    ...landed('h07', [['01:00', 'hold-started', { hold: 'race' }], ['01:10', 'hold-ended', { hold: 'race' }]]),
    ...handedBack('h08', [['gate-signed', { standing: false, gates: 2 }]], 'gate'),
    ...landed('h09', [['01:00', 'hold-started', { hold: 'race' }], ['01:05', 'race-decided', { mark: 'RACE', by: 'resume' }], ['01:10', 'hold-ended', { hold: 'race' }]]),
    ...handedBack('h10', [['auto-retry', { stage: 'implement', setAsideAt: 'run', retryClass: 'agent', used: 1, budget: 2 }]]),
    [at('00:00'), 'slot-taken', 'h11', { settings: S(11), start: 'start' }],
    [at('01:00'), 'slot-freed', 'h11', { outcome: 'set-aside' }],
    [at('01:00'), 'set-aside', 'h11', { stage: 'implement', reasonClass: 'blocked', setAsideAt: 'run' }],
    [at('01:30'), 'answer-recorded', 'h11', { answerKind: 'decision', form: 'left', pr: false }],
  ])
}

test('hands-off rate: the landed tasks with no act from Lachy, read from the verbs\' events only', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', handsOffRecord())
  const out = scored(home, ['--until', at('04:00'), '--settings', writeSettings(home, { parallel_ceiling: 11 })])
  const h = out.handsOff
  assert.deepEqual([h.rate, h.landed, h.handsOff], [0.5, 10, 5])
  assert.deepEqual(Object.fromEntries(h.tasks.map((x) => [x.task, x.acts.map((a) => a.kind)])), {
    h01: [], h02: ['mergeHold'], h03: ['answer'], h04: [], h05: [], h06: ['retry'], h07: [], h08: ['signOff'], h09: ['raceDecided'], h10: [],
  }, 'h11 never landed: its answer is outside the denominator')
  assert.deepEqual(h.byKind, { answer: 1, signOff: 1, retry: 1, mergeHold: 1, raceDecided: 1 })
  assert.deepEqual(h.notCounted, { standingApproval: 1, automaticHandBack: 2, raceReverified: 1 })
  const [answer] = h.tasks.find((x) => x.task === 'h03').acts
  assert.equal(answer.at, Z(at('01:30')))
  assert.match(answer.detail, /needs-you/)
  assert.equal(h.baseline, null, 'no baseline')
  assert.ok(!has(out.flags, /no recorded cause/), out.flags.join('\n'))
  assert.equal(out.headline.handsOffRate, 0.5)
  // no --repo and no tasks dir under the scratch HOME: every Escape source is unread, so Quality is null; no review round
  assert.deepEqual([out.headline.quality, out.headline.reviewChurn], [out.escapes.quality, out.reviewChurn.value])
  assert.deepEqual([out.headline.quality, out.headline.reviewChurn], [null, null])
  assert.ok(!('quality' in out), 'Quality is escapes.quality (p21-4): no placeholder object')
  assert.deepEqual(out.guardrails.reviewChurn, { value: 'unknown', bound: '<=40%', baseline: null, breached: false, roundsPerLandedTask: null })
  assert.match(score(home, ['--until', at('04:00')]).stderr, /^score: demo: hands-off 0\.5 \(5 of 10\), /)
})

// The header's window: an act counts for a task from the run's start (the record's first slot-taken, 00:00 here) to
// the task's first merge, both ends inclusive. h01 lands at 01:10 and h07 (a race hold, no decision) at 01:10.
test('hands-off rate: an act before the run\'s start or after the task\'s merge never counts; one on either edge does', (t) => {
  const base = tmpHome(t)
  emitAll(base, 'demo', handsOffRecord())
  const want = scored(base, ['--until', at('04:00')]).handsOff
  const home = tmpHome(t)
  emitAll(home, 'demo', byTs([
    ...handsOffRecord(),
    [D(4, '23:59'), 'answer-recorded', 'h01', { answerKind: 'decision', form: 'left', pr: false }], // before the run's start
    [at('01:11'), 'gate-signed', 'h01', { standing: false, gates: 1 }], // after h01's merge
    [at('01:20'), 'race-decided', 'h07', { mark: 'RACE', by: 'resume' }], // after h07's merge: it stays a green re-verify
  ]))
  const out = scored(home, ['--until', at('04:00')])
  assert.deepEqual(out.handsOff, want, 'the rate, every task\'s acts, byKind and notCounted are unchanged')
  assert.deepEqual([out.handsOff.rate, out.handsOff.tasks.find((x) => x.task === 'h01').acts, out.handsOff.notCounted.raceReverified], [0.5, [], 1])
  assert.deepEqual(out.handsOff.byKind, { answer: 1, signOff: 1, retry: 1, mergeHold: 1, raceDecided: 1 })
  const edge = tmpHome(t)
  emitAll(edge, 'demo', byTs([
    ...handsOffRecord(),
    [at('00:00'), 'answer-recorded', 'h01', { answerKind: 'decision', form: 'left', pr: false }], // at the run's start
    [at('01:10'), 'gate-signed', 'h01', { standing: false, gates: 1 }], // at h01's merge
  ]))
  const e = scored(edge, ['--until', at('04:00')]).handsOff
  assert.deepEqual([e.rate, e.landed, e.handsOff], [0.4, 10, 4])
  assert.deepEqual(e.tasks.find((x) => x.task === 'h01').acts.map((a) => [a.kind, a.at]), [['answer', Z(at('00:00'))], ['signOff', Z(at('01:10'))]])
  assert.deepEqual(e.byKind, { answer: 2, signOff: 2, retry: 1, mergeHold: 1, raceDecided: 1 })
})

test('hands-off rate: a hand-back with no recorded cause (a record from before p21-2) is flagged and reads hands-off', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', byTs([...landed('l1'), ...handedBack('l2', [])]))
  const out = scored(home, ['--until', at('04:00')])
  assert.deepEqual([out.handsOff.rate, out.handsOff.landed], [1, 2])
  assert.ok(has(out.flags, new RegExp(`^\\[\\[l2\\]\\]: slot-taken start=hand-back at ${Z(at('02:00')).replace(/\./g, '\\.')} .*no recorded cause: not counted`)), out.flags.join('\n'))
})

test('hands-off rate: nothing landed is null, flagged; a git-env hold is a rollout-level wait', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', [[at('00:00'), 'slot-taken', 'a', { settings: S(2) }], [at('01:00'), 'slot-freed', 'a', { outcome: 'set-aside' }],
    [at('01:30'), 'hold-started', null, { hold: 'git-env' }], [at('02:00'), 'hold-ended', null, { hold: 'git-env' }]])
  const out = scored(home, ['--until', at('03:00')])
  assert.deepEqual([out.handsOff.rate, out.handsOff.landed, out.headline.handsOffRate], [null, 0, null])
  assert.ok(has(out.flags, /^hands-off rate: nothing landed in the window/))
  assert.ok(has(out.flags, /git-env hold .*rollout-level wait/))
})

// An act's own line is no activity of the task's call: an open Slot whose call has no journal ends at its last real
// activity + GRACE, however late Lachy's acts on it come.
test('an act stamped while an untimed call is open never extends its Slot', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', [
    [at('00:00'), 'slot-taken', 'a', { settings: S(2) }],
    [at('00:00'), 'run-bound', 'a', { runId: 'wf_a', journalDir: '/nonexistent' }],
    [at('02:00'), 'answer-recorded', 'a', { answerKind: 'decision' }],
    [at('02:00'), 'race-decided', 'a', { mark: 'RACE', by: 'hand-back' }],
  ])
  const out = scored(home, ['--until', at('06:00')])
  assert.equal(out.runningTime.hours, 0.5, 'the Slot ends at its start + 30 min, not at 02:30')
  assert.equal(out.window.activeEnd, Z(at('00:30')))
})

// p28-2: the night record is `next`'s reading of a Morning after the fact. A dead lead's Slot (s1, taken at 07:30, its
// call wf_1 with no journal) still open at the 09:00 Morning gets a ran-past-morning line at the next lead's 12:00
// call (execute away.md § The night record): that line, the night's marker and a held line are no activity of the
// call, so its never-finished cap, the running time and Throughput read as they do with no night line at all.
test('a night-record line never extends an untimed call\'s Slot (p28-2)', (t) => {
  const slot = [
    [at('07:30'), 'slot-taken', 's1', { settings: S(2) }],
    [at('07:30'), 'run-bound', 's1', { runId: 'wf_1', journalDir: '/nonexistent' }],
  ]
  const night = [
    [at('07:00'), 'away-night', null, { morning: at('09:00') }],
    [at('07:30'), 'last-start-held', 'c1', { morning: at('09:00'), scope: 'cross-cutting', history: 3, usualMinutes: 110 }],
    [at('12:00'), 'ran-past-morning', 's1', { morning: at('09:00'), slotTakenAt: '2026-10-05T07:30:00.000Z', scope: 'single-file', history: 3, usualMinutes: 25 }],
  ]
  const run = (events) => {
    const home = tmpHome(t)
    emitAll(home, 'demo', byTs(events))
    return scored(home, ['--since', at('07:30'), '--until', at('14:00'), '--settings', writeSettings(home, { parallel_ceiling: 2 })])
  }
  const bare = run(slot)
  const out = run([...slot, ...night])
  for (const o of [bare, out]) {
    assert.equal(o.runningTime.hours, 0.5, 'the Slot ends at its last activity (07:30) + 30 min, not at 12:30')
    assert.equal(o.window.activeEnd, Z(at('08:00')))
    assert.ok(has(o.flags, new RegExp(`^call wf_1 never finished: capped at last activity \\+ 30 min \\(${Z(at('08:00')).replace(/\./g, '\\.')}\\)$`)))
    assert.equal(o.guardrails.throughput.breached, false, '0.5 running h against one task\'s 1.5 h allowance')
  }
  assert.deepEqual(out.guardrails.throughput, bare.guardrails.throughput, 'Throughput reads as with no night line')
  const flags = (o) => o.flags.map((f) => f.replace(/reflect-score-[^/]+/g, 'HOME')) // each run its own temp HOME
  assert.deepEqual(flags(out), flags(bare), 'and so does every flag')
})

// p29-10 (ADR 0051): the time-lost ledger's kinds (stopped, lead-entry, suite-started, suite-ended, base-moved) are not
// scored yet (p29-11 scores them). Interleaved anywhere, a task's suites inside an untimed call's Slot and a halt after
// the record's last line included, they leave every score, flag and window byte-equal; and a concurrent record whose
// only late lines are ledger lines (a heartbeat's entries, a halt) never reads as live past its last real line.
const ledgerScore = (t, events, others = []) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', byTs(events))
  for (const [slug, evs] of others) emitAll(home, slug, byTs(evs))
  const out = scored(home, ['--until', D(5, '14:00'), '--settings', writeSettings(home, { parallel_ceiling: 3 })])
  return JSON.parse(JSON.stringify(out).replace(/reflect-score-[^/"]+/g, 'HOME'))
}
const SUITE_ID = (n) => `s-${String(n).padStart(16, '0')}`
test('the ledger kinds (p29-10) are skipped: a record scores byte-equal with or without them', (t) => {
  const untimed = [
    [at('07:00'), 'slot-taken', 'g', { settings: S(3) }],
    [at('07:00'), 'run-bound', 'g', { runId: 'wf_g', journalDir: '/nonexistent' }],
  ]
  const ledger = [
    [at('00:00'), 'lead-entry', null, { by: 'stage', session: 'A' }],
    [at('00:20'), 'lead-entry', null, { by: 'heartbeat', session: 'A' }],
    [at('01:00'), 'suite-started', 'a', { suite: SUITE_ID(1), by: 'task', runner: 'agent', sha: 'a'.repeat(40), dirty: false, load: [1, 2, 3], running: 3 }],
    [at('01:30'), 'suite-ended', 'a', { suite: SUITE_ID(1), by: 'task', runner: 'agent', outcome: 'red', seconds: 1800, rc: 1, failing: ['t::x'] }],
    [at('05:10'), 'base-moved', 'f', { repo: 'o/r', pr: 7, base: 'b'.repeat(40), main: 'c'.repeat(40), inertOnly: false, moversTotal: 0, movers: [] }],
    [at('06:10'), 'stopped', null, { cause: 'mac-sleep', inferred: true, at: at('06:05'), wake: at('06:08'), calls: [] }],
    [at('07:40'), 'suite-started', 'g', { suite: SUITE_ID(2), by: 'task', runner: 'agent', sha: 'd'.repeat(40), dirty: true, diff: 'abcdef012345' }],
    [at('08:10'), 'suite-ended', 'g', { suite: SUITE_ID(2), by: 'task', runner: 'agent', outcome: 'green', seconds: 1800, rc: 0 }],
    [at('09:30'), 'stopped', null, { cause: 'dead-lead', inferred: true, at: at('09:00'), calls: [{ task: 'g', runId: 'wf_g', call: 'task' }] }],
    [at('09:30'), 'lead-entry', null, { by: 'stage', session: 'B', stop: 'dead-lead' }],
    [at('13:00'), 'stopped', null, { cause: 'halt', inferred: false, calls: [], reason: 'stuck' }],
  ]
  const bare = ledgerScore(t, [...slotBound(), ...untimed])
  const out = ledgerScore(t, [...slotBound(), ...untimed, ...ledger])
  assert.deepEqual(out, bare)
  assert.ok(has(out.flags, /^call wf_g never finished: capped at last activity \+ 30 min/), 'g\'s suites never extend its untimed call')
})

test('ledger-only late lines (p29-10) never extend a concurrent record\'s live span', (t) => {
  const other = [
    [at('00:00'), 'slot-taken', 'o1', { settings: S(2) }],
    [at('00:00'), 'run-bound', 'o1', { runId: 'wf_o1', journalDir: '/nonexistent' }],
    [at('01:00'), 'slot-freed', 'o1', { outcome: 'set-aside' }],
  ]
  const late = [
    [at('03:00'), 'lead-entry', null, { by: 'heartbeat' }],
    [at('05:00'), 'lead-entry', null, { by: 'heartbeat' }],
    [at('06:00'), 'stopped', null, { cause: 'halt', inferred: false, calls: [] }],
  ]
  const bare = ledgerScore(t, slotBound(), [['other', other]])
  const out = ledgerScore(t, slotBound(), [['other', [...other, ...late]]])
  assert.deepEqual(out, bare)
})

test('Throughput counts the tasks whose Slot or lane holding overlaps a mid-run window (a --since split)', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', slotBound())
  const out = scored(home, ['--since', at('04:30'), '--until', at('12:00'), '--settings', writeSettings(home, { parallel_ceiling: 3 })])
  assert.deepEqual([out.guardrails.throughput.tasks, out.guardrails.throughput.allowanceHours, out.guardrails.throughput.breached], [3, 4.5, false],
    'd, e and f overlap 04:30; a, b and c ended before it, Slot and lane holding both')
  const split = scored(home, ['--since', at('04:10'), '--until', at('12:00'), '--settings', writeSettings(home, { parallel_ceiling: 3 })])
  assert.deepEqual([split.guardrails.throughput.tasks, split.guardrails.throughput.allowanceHours], [4, 6],
    'c\'s Slot ended at 04:00, but it integrates 04:00-04:20, inside the window: it earns its allowance too')
})

// A supersede's carried awaiting-integration tasks: c1-c4 were carried in from old-demo and only integrate here (no
// Slot in this record), one after another for an hour each from 01:10; s1 runs a Slot 00:00-01:00 and integrates
// 01:00-01:10. Running time is 00:00-04:16 (each lane-only stretch is under the 2 h cap): 4.267 h for five landed
// tasks. Counting Slots alone gave 1 task, a 1.5 h allowance and a false breach that withholds every round raise.
test('Throughput: lane-only landed tasks (a supersede\'s carried ones) earn their allowance; no false breach', (t) => {
  const home = tmpHome(t)
  const carried = ['c1', 'c2', 'c3', 'c4']
  const lanes = [['01:10', '02:10'], ['02:10', '03:10'], ['03:10', '04:10'], ['04:10', '04:16']]
  emitAll(home, 'demo', byTs([
    ...carried.map((c) => [at('00:00'), 'carried', c, { from: 'old-demo' }]),
    ...life('s1', { from: at('00:00'), to: at('01:00'), c: 2, lane: [at('01:00'), at('01:10')] }),
    ...carried.flatMap((c, i) => [
      [at(lanes[i][0]), 'lane-taken', c, {}],
      [at(lanes[i][1]), 'lane-freed', c, { release: 'merge', path: 'lead', triggers: [], conflict: false }],
      [at(lanes[i][1]), 'merged', c, { pr: 7 }],
    ]),
  ]))
  const out = scored(home, ['--until', at('06:00'), '--settings', writeSettings(home, { parallel_ceiling: 2 })])
  assert.deepEqual([out.merges.count, out.runningTime.hours], [5, 4.267])
  assert.deepEqual(out.guardrails.throughput, { value: 1.172, runningHours: 4.267, tasks: 5, allowanceHours: 7.5,
    bound: '<= 1.5 running h per task', baseline: null, breached: false })
  assert.deepEqual(Object.keys(out.guardrails), ['throughput', 'tokensPerMerge', 'setAsideRate', 'conflictRate', 'quotaStalls', 'reviewChurn'],
    'the Guardrails, in score.py GUARDRAILS\' order (the weigh() test pins that tuple)')
})

// ---- ADR 0064: an origin yield is a pause inside one Integration (R1-R4) -------------------------------------------
// x runs a Slot 09:00-10:00 (ready at 10:00) and integrates from 10:00; at 10:20 its lead yields the origin lane to
// another rollout's Integration (lane-freed release=origin), takes it again at 10:50, and merges at 11:00 with a
// resolved conflict. The yield's 30 minutes hold no lane.
function originYield({ first = { release: 'origin', origin: 'o/r' }, between = [] } = {}) {
  return byTs([
    ...life('x', { from: at('09:00'), to: at('10:00'), c: 2 }),
    [at('10:00'), 'lane-taken', 'x', {}],
    [at('10:20'), 'lane-freed', 'x', first],
    ...between,
    [at('10:50'), 'lane-taken', 'x', {}],
    [at('11:00'), 'lane-freed', 'x', { release: 'merge', path: 'integrator', triggers: ['conflict'], conflict: true }],
    [at('11:00'), 'merged', 'x', { pr: 7 }],
  ])
}

test('R1: an origin yield and its re-take are one Integration; the gap is no lane busy time', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', originYield())
  const out = scored(home, ['--until', at('12:00'), '--settings', writeSettings(home, { parallel_ceiling: 2 })])
  assert.equal(out.lane.integrations, 1, 'one Integration across the yield')
  assert.equal(out.lane.conflicts, 1, 'its conflict, from its last holding')
  assert.equal(out.lane.integratorPath, 1, '… and its integrator path')
  assert.equal(out.headline.conflictRate, 1, 'conflict rate 1.0 (one conflicting Integration of one)')
  assert.equal(out.lane.busyHours, 0.5, '10:00-10:20 and 10:50-11:00: the 30-minute gap held no lane')
  assert.deepEqual(out.lane.waitsMinutes, [0], 'ready -> the first holding, at 10:00')
})

test('R2 (control): a set-aside release, its set-aside line and a hand-back between: two Integrations', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', originYield({
    first: { release: 'set-aside', path: 'lead', triggers: [], conflict: false },
    between: [[at('10:20'), 'set-aside', 'x', { stage: 'integrate', reasonClass: 'merge-task', setAsideAt: 'integration' }],
      [at('10:40'), 'handed-back', 'x', { via: 'retry', arm: 'integration' }]],
  }))
  const out = scored(home, ['--until', at('12:00'), '--settings', writeSettings(home, { parallel_ceiling: 2 })])
  assert.equal(out.lane.integrations, 2)
})

test('R3: an origin yield, then a from-file carried line: each record counts its own Integration', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', byTs([
    ...life('x', { from: at('09:00'), to: at('10:00'), c: 2 }),
    [at('10:00'), 'lane-taken', 'x', {}],
    [at('10:20'), 'lane-freed', 'x', { release: 'origin', origin: 'o/r' }],
  ]))
  emitAll(home, 'demo2', byTs([
    [at('10:30'), 'carried', 'x', { from: 'demo' }],
    [at('10:50'), 'lane-taken', 'x', {}],
    [at('11:00'), 'lane-freed', 'x', { release: 'merge', path: 'lead', triggers: [], conflict: false }],
    [at('11:00'), 'merged', 'x', { pr: 7 }],
  ]))
  const a = scored(home, ['--until', at('12:00'), '--settings', writeSettings(home, { parallel_ceiling: 2 })], { rollout: 'demo' })
  const b = scored(home, ['--until', at('12:00'), '--settings', writeSettings(home, { parallel_ceiling: 2 })], { rollout: 'demo2' })
  assert.deepEqual([a.lane.integrations, b.lane.integrations], [1, 1], 'the carrying rollout counts its own, from its own first holding')
})

test('R4: an Integration begun before --since that continues inside the window counts 0 there, its conflict too', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', originYield())
  const out = scored(home, ['--since', at('10:30'), '--until', at('12:00'), '--settings', writeSettings(home, { parallel_ceiling: 2 })])
  assert.equal(out.lane.integrations, 0)
  assert.equal(out.lane.conflicts, 0, 'the continuation\'s conflict is not counted')
})

test('weigh(): a trade only when both headlines it names are scored', () => {
  const body = [
    'import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("score", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'print(json.dumps([m.weigh("review-rounds-raise", {"handsOffRate": 0.8, "quality": None}),',
    '                  m.weigh("review-rounds-raise", {"handsOffRate": 0.8, "quality": 0.9}),',
    '                  m.weigh("slot-bound-raise", {"handsOffRate": 0.8, "quality": 0.9}),',
    '                  m.weigh("slot-bound-raise", {"handsOffRate": None, "quality": None}),',
    '                  m.weigh("quota-bound-lower", {"handsOffRate": 0.8, "quality": 0.9}), list(m.HEADLINES),',
    '                  m.weigh("no-such-rule", {"handsOffRate": 0.8, "quality": 0.9}), list(m.GUARDRAILS),',
    '                  m.weigh("plan-rejected-raise", {"handsOffRate": 0.8, "quality": 0.9})]))',
  ].join('\n')
  const r = spawnSync('python3', ['-B', '-c', body, SCORE], { encoding: 'utf8', env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1' } })
  assert.equal(r.status, 0, r.stderr)
  const [rrNull, rrTrade, slot, slotNull, lower, headlines, undeclared, guardrails, plan] = JSON.parse(r.stdout)
  assert.equal(rrNull.trade, null, 'Quality unscored: no trade')
  assert.deepEqual(rrTrade.trade, { gains: ['handsOffRate'], costs: ['quality'] })
  assert.deepEqual([slot.trade, slotNull.trade], [null, null], 'a slot-bound raise names no headline')
  assert.deepEqual([lower.serves, lower.risks, lower.trade], [['quotaStalls'], ['throughput'], null])
  assert.deepEqual(headlines, ['handsOffRate', 'quality'])
  assert.deepEqual(guardrails, ['throughput', 'tokensPerMerge', 'setAsideRate', 'conflictRate', 'quotaStalls', 'reviewChurn'])
  assert.deepEqual(undeclared, { serves: [], risks: guardrails, trade: null }, 'a rule RULE_EFFECTS does not declare fails closed: it risks every Guardrail')
  // Review churn's absolute bound (p21-3) withholds any raise, as it did when it landed: every raise risks it
  for (const w of [rrTrade, slot, plan]) assert.ok(w.risks.includes('reviewChurn'), JSON.stringify(w.risks))
  assert.deepEqual(plan.trade, { gains: ['handsOffRate'], costs: ['quality'] }, 'both round raises trade once Quality is scored')
})

// Every rule propose() can emit has a declared effect, so none reaches weigh()'s fail-closed default by accident: the
// rule names written in propose()'s source are exactly RULE_EFFECTS' keys. A new rule fails here until it is declared.
test('the rules propose() emits are exactly RULE_EFFECTS\' keys', () => {
  const body = [
    'import importlib.util, inspect, json, re, sys',
    'spec = importlib.util.spec_from_file_location("score", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'src = inspect.getsource(m.Score.propose)',
    'print(json.dumps([sorted(set(re.findall(r\'"([a-z]+(?:-[a-z]+)*-(?:raise|lower))"\', src))), sorted(m.RULE_EFFECTS)]))',
  ].join('\n')
  const r = spawnSync('python3', ['-B', '-c', body, SCORE], { encoding: 'utf8', env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1' } })
  assert.equal(r.status, 0, r.stderr)
  const [emitted, declared] = JSON.parse(r.stdout)
  assert.deepEqual(emitted, ['plan-rejected-raise', 'quota-bound-lower', 'review-rounds-raise', 'slot-bound-raise'], 'the scan found the four rules')
  assert.deepEqual(emitted, declared)
})

// The fail-closed default end to end: with review-rounds-raise's declaration removed in memory, a breached Throughput
// still withholds that raise (with no declaration it risks every Guardrail), never lets it through.
test('an undeclared rule\'s raise is withheld by any breached Guardrail', (t) => {
  const home = tmpHome(t)
  const ev = saturated(3, { settings: () => S(3, { max_review_rounds: 4 }) })
  ev.push([at('03:00'), 'set-aside', 't1', { stage: 'review', reasonClass: 'review-rounds', setAsideAt: 'run' }])
  ev.push([at('03:30'), 'set-aside', 't2', { stage: 'review', reasonClass: 'review-rounds', setAsideAt: 'run' }])
  emitAll(home, 'demo', byTs(ev))
  const settings = writeSettings(home, { parallel_ceiling: 4, max_review_rounds: 4 }, { guardrails: { hours_per_task: 1.0 } })
  const body = [
    'import importlib.util, sys',
    'spec = importlib.util.spec_from_file_location("score", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'del m.RULE_EFFECTS["review-rounds-raise"]',
    'sys.exit(m.main(sys.argv[2:]))',
  ].join('\n')
  const r = spawnSync('python3', ['-B', '-c', body, SCORE, '--rollout', 'demo', '--until', at('06:00'), '--settings', settings],
    { encoding: 'utf8', cwd: home, env: baseEnv(home) })
  assert.equal(r.status, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.equal(out.guardrails.throughput.breached, true, '4.5 running h against 3 h')
  const w = out.withheld.find((x) => x.rule === 'review-rounds-raise')
  assert.ok(w, JSON.stringify(out.proposals))
  assert.deepEqual([w.serves, w.risks], [[], ['throughput', 'tokensPerMerge', 'setAsideRate', 'conflictRate', 'quotaStalls', 'reviewChurn']])
  assert.match(w.reason, /^a raise while a Guardrail is breached: throughput /)
})

// ---- 5. edge cases --------------------------------------------------------------------------------------------

test('no merge: Throughput 0.0; zero running time: null, flagged', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', [...life('a', { from: at('00:00'), to: at('02:00'), c: 2, outcome: 'set-aside' })])
  const out = scored(home, ['--until', at('03:00'), '--settings', writeSettings(home, {})])
  assert.equal(out.merges.count, 0)
  assert.equal(out.throughput, 0)
  assert.equal(out.headline.runningHours, 2)
  const z = scored(home, ['--since', at('02:30'), '--until', at('03:00')])
  assert.equal(z.throughput, null)
  assert.ok(has(z.flags, /^zero running time/))
  assert.deepEqual([z.guardrails.throughput.tasks, z.guardrails.throughput.breached], [0, false], 'zero running time never breaches')
})

test('no record: an empty score, flagged, exit 0', (t) => {
  const home = tmpHome(t)
  const out = scored(home, ['--until', at('03:00'), '--repo-slug', 'o/r'])
  assert.ok(has(out.flags, /^no record$/))
  assert.deepEqual(out.headline, { throughput: null, runningHours: 0, merges: 0, tokensPerMerge: null, setAsideRate: null, conflictRate: null, quotaStalls: 0,
    handsOffRate: null, quality: null, reviewChurn: null })
  assert.deepEqual(out.proposals, [])
})

test('a mid-run tail: an open Slot whose call is still active runs to --until, and the window is partial', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', [
    [at('00:00'), 'slot-taken', 'a', { settings: S(2) }],
    [at('00:00'), 'run-bound', 'a', { runId: 'wf_a', journalDir: '/nonexistent' }],
    [at('02:40'), 'call-journal', null, { runId: 'wf_a', status: 'running', startTime: ms(at('00:00')), durationMs: 160 * 60000 }],
  ])
  const out = scored(home, ['--until', at('03:00')])
  assert.equal(out.window.partial, true)
  assert.equal(out.window.activeEnd, Z(at('03:00')))
  assert.equal(out.runningTime.hours, 3)
})

test('a stale non-terminal journal: the Slot is capped at last activity + 30 min, never days later', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', [
    [at('08:00'), 'slot-taken', 'a', { settings: S(2) }],
    [at('08:00'), 'run-bound', 'a', { runId: 'wf_a', journalDir: '/nonexistent' }],
    [at('10:00'), 'call-journal', null, { runId: 'wf_a', status: 'running', startTime: ms(at('08:00')), durationMs: 2 * 3600e3 }],
  ])
  const out = scored(home, ['--until', D(8, '12:00')])
  assert.equal(out.window.partial, false)
  assert.equal(out.window.activeEnd, Z(at('10:30')))
  assert.equal(out.runningTime.hours, 2.5)
  assert.ok(has(out.flags, new RegExp(`^call wf_a never finished: capped at last activity \\+ 30 min \\(${Z(at('10:30')).replace(/\./g, '\\.')}\\)$`)))
  const nf = out.runningTime.excluded.find((e) => e.kind === 'never-finished')
  assert.deepEqual([nf.start, nf.end], [Z(at('10:30')), Z(D(8, '12:00'))])
})

test('a non-terminal journal with no durationMs falls back to the task\'s last record line, flagged', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', [
    [at('08:00'), 'slot-taken', 'a', { settings: S(2) }],
    [at('08:00'), 'run-bound', 'a', { runId: 'wf_a', journalDir: '/nonexistent' }],
    [at('09:00'), 'quota-stall', 'a', {}],
    [at('09:10'), 'call-journal', null, { runId: 'wf_a', status: 'running' }],
  ])
  const out = scored(home, ['--until', at('20:00')])
  assert.equal(out.window.activeEnd, Z(at('09:30')), 'the task\'s last line (09:00) + 30 min')
  assert.ok(has(out.flags, /^call wf_a has no durationMs: \[\[a\]\]'s last activity is its last record line/))
})

test('a dead lead: a terminal call with its Slot left open is excluded past the grace, flagged', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', byTs([
    ...life('a', { from: at('00:00'), to: at('09:00'), c: 2, journal: { durationMs: 2 * 3600e3 }, lane: [at('09:00'), at('09:10')] }),
  ]))
  const out = scored(home, ['--until', at('09:10')])
  assert.equal(out.runningTime.hours, 2.667, '00:00-02:30 and the 10-min Integration')
  const gap = out.runningTime.excluded.find((e) => e.kind === 'lead-absent')
  assert.deepEqual([gap.start, gap.end], [Z(at('02:30')), Z(at('09:00'))])
  assert.ok(has(out.flags, /^lead absent: \[\[a\]\]'s call wf_a ended at/))
})

// p29-12: reconcile stamps a Slot-ending row's events at its call's own end (here 02:00) and carries the moment the
// lead turned to it as reconciledAt (09:00). The Slot reads to that release, so the dead-lead reading above holds
// unchanged; the ready line at the call's end makes the lane wait the true one.
test('a slot-freed stamped at its call\'s end reads to its reconciledAt: lead absent as before, the true lane wait', (t) => {
  const home = tmpHome(t)
  const late = { stamp: 'call-end', reconciledAt: Z(at('09:00')) }
  emitAll(home, 'demo', byTs([
    [at('00:00'), 'slot-taken', 'a', { settings: S(2), start: 'start' }],
    [at('00:00'), 'run-bound', 'a', { runId: 'wf_a', journalDir: '/nonexistent/workflows', call: 'task' }],
    [at('02:00'), 'slot-freed', 'a', { outcome: 'ready', ...late }],
    [at('02:00'), 'ready', 'a', { pr: 7, ...late }],
    [at('09:00'), 'call-journal', null, { runId: 'wf_a', status: 'completed', mode: 'task', startTime: ms(at('00:00')), durationMs: 2 * 3600e3, tokens: 100000 }],
    [at('09:00'), 'lane-taken', 'a', {}],
    [at('09:10'), 'lane-freed', 'a', { release: 'merge', path: 'lead', triggers: [], conflict: false }],
    [at('09:10'), 'merged', 'a', { pr: 7 }],
  ]))
  const out = scored(home, ['--until', at('09:10')])
  assert.equal(out.runningTime.hours, 2.667, 'as the dead-lead case: 00:00-02:30 and the 10-min Integration')
  const gap = out.runningTime.excluded.find((e) => e.kind === 'lead-absent')
  assert.deepEqual([gap.start, gap.end], [Z(at('02:30')), Z(at('09:00'))])
  assert.ok(has(out.flags, /^lead absent: \[\[a\]\]'s call wf_a ended at/))
  assert.deepEqual(out.lane.waitsMinutes, [420], 'the wait for the lane runs from the call\'s end, not the lead\'s turn')
  // Control: the same record with no reconciledAt reads the Slot as freed at the call's end, with no lead absence.
  const home2 = tmpHome(t)
  emitAll(home2, 'demo', byTs([
    [at('00:00'), 'slot-taken', 'a', { settings: S(2), start: 'start' }],
    [at('00:00'), 'run-bound', 'a', { runId: 'wf_a', journalDir: '/nonexistent/workflows', call: 'task' }],
    [at('02:00'), 'slot-freed', 'a', { outcome: 'ready' }],
    [at('09:00'), 'call-journal', null, { runId: 'wf_a', status: 'completed', mode: 'task', startTime: ms(at('00:00')), durationMs: 2 * 3600e3, tokens: 100000 }],
  ]))
  const out2 = scored(home2, ['--until', at('09:10')])
  assert.ok(!out2.runningTime.excluded.some((e) => e.kind === 'lead-absent'), 'no reconciledAt: no lead-absent gap')
})

// fold-journals stamps a call-journal line with the fold time (here 12:00), so a split at 06:00 must still read it.
test('journals folded after --until are read, and each call is clamped to --until', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', byTs([
    ...life('a', { from: at('00:00'), to: at('02:00'), c: 2, lane: [at('02:00'), at('02:10')], fold: at('12:00') }),
    ...life('b', { from: at('00:00'), to: at('10:00'), c: 2, lane: [at('10:00'), at('10:10')], tokens: 300000, fold: at('12:00') }),
  ]))
  const early = scored(home, ['--until', at('06:00')])
  assert.equal(early.runningTime.hours, 6, 'b\'s call ran past 06:00: its Slot is active to --until')
  assert.deepEqual(early.runningTime.excluded, [])
  assert.equal(early.window.partial, true, 'a Slot still running at --until')
  assert.equal(early.merges.count, 1)
  assert.equal(early.headline.tokensPerMerge, 400000, 'both calls started in the window')
  assert.ok(!has(early.flags, /never finished|no call journal/))
  const whole = scored(home, ['--until', at('12:00')])
  assert.equal(whole.runningTime.hours, 10.167)
  assert.equal(whole.window.partial, false)
  assert.equal(whole.headline.tokensPerMerge, 200000)
})

// A restart after a dead lead re-takes the open Slot (keeping its first start) and binds a second call: the gap
// between the first call's last activity and the second call's start is not running time.
test('a dead lead inside one Slot: the gap between its calls is excluded and labelled', (t) => {
  const restart = (wf1) => byTs([
    [at('00:00'), 'slot-taken', 'a', { settings: S(2) }],
    [at('00:00'), 'run-bound', 'a', { runId: 'wf1', journalDir: '/nonexistent', call: 'task' }],
    [at('09:00'), 'slot-taken', 'a', { settings: S(2) }],
    [at('09:00'), 'run-bound', 'a', { runId: 'wf2', journalDir: '/nonexistent', call: 'task' }],
    [at('10:00'), 'slot-freed', 'a', { outcome: 'ready' }],
    [at('11:00'), 'call-journal', null, { runId: 'wf1', startTime: ms(at('00:00')), durationMs: 3600e3, tokens: 5, ...wf1 }],
    [at('11:00'), 'call-journal', null, { runId: 'wf2', status: 'completed', startTime: ms(at('09:00')), durationMs: 3600e3, tokens: 5 }],
  ])
  const home = tmpHome(t)
  emitAll(home, 'demo', restart({ status: 'running' }))
  const out = scored(home, ['--until', at('10:00')])
  assert.equal(out.runningTime.hours, 2.5, '00:00-01:30 (wf1 + grace) and 09:00-10:00 (wf2)')
  assert.deepEqual(out.runningTime.excluded.map((e) => [e.kind, e.start, e.end]), [['never-finished', Z(at('01:30')), Z(at('09:00'))]])
  assert.ok(has(out.flags, /^call wf1 never finished: its last activity was .*; wf2 re-took \[\[a\]\]'s Slot at /))
  assert.equal(out.window.activeEnd, Z(at('10:00')))

  const home2 = tmpHome(t)
  emitAll(home2, 'demo', restart({ status: 'failed' }))
  const out2 = scored(home2, ['--until', at('10:00')])
  assert.equal(out2.runningTime.hours, 2.5)
  assert.deepEqual(out2.runningTime.excluded.map((e) => [e.kind, e.start, e.end]), [['lead-absent', Z(at('01:30')), Z(at('09:00'))]])
  assert.ok(has(out2.flags, /^lead absent: \[\[a\]\]'s call wf1 ended at .*; the next call wf2 started at /))
})

test('no call journal: the Slot ends at its slot-freed, flagged', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', life('a', { from: at('00:00'), to: at('02:00'), c: 2, journal: false, lane: [at('02:00'), at('02:10')] }))
  const out = scored(home, ['--until', at('03:00')])
  assert.equal(out.runningTime.hours, 2.167)
  assert.ok(has(out.flags, /^no call journal for \[\[a\]\]: its Slot ends at its slot-freed$/))
  assert.equal(out.headline.tokensPerMerge, null)
  assert.equal(out.guardrails.tokensPerMerge.value, 'unknown')
})

test('load: an overlapping same-host record counts; another host\'s lines are parsed and ignored; reviews and tunings never', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', byTs(saturated(3)))
  emitAll(home, 'other-run', byTs(life('z', { from: at('01:00'), to: at('03:00'), c: 2, lane: [at('03:00'), at('03:10')] })))
  emitAll(home, 'old-run', byTs(life('y', { from: D(1, '01:00'), to: D(1, '03:00'), c: 2 })))
  emitAll(home, 'x', [tuningLine(at('02:00'), 't-z', [at('01:00'), at('02:00'), null, null])])
  emitAll(home, 'x', [[at('02:00'), 'review-round', null, { repo: 'o/r', head: 'abc', digest: 'd' }, null]])
  const foreign = { v: 1, ts: '2026-10-05T01:00:00.000Z', host: 'elsewhere-box', rollout: 'far-run', task: 'q', kind: 'slot-taken', settings: S(9) }
  fs.appendFileSync(path.join(evDir(home), 'far-run.jsonl'), JSON.stringify(foreign) + '\n' + JSON.stringify({ ...foreign, kind: 'merged', ts: '2026-10-05T02:00:00.000Z' }) + '\n')
  const out = scored(home, ['--until', at('06:00')])
  assert.deepEqual(out.load.rollouts.map((r) => [r.rollout, r.start, r.end, r.slotsTaken, r.merges]), [['other-run', Z(at('01:00')), Z(at('03:10')), 1, 1]])
  assert.equal(out.load.otherHostLinesIgnored, 2)
  assert.notEqual(out.host, 'elsewhere-box')
})

// demo ran Mon 00:00-02:10; other ran Tue 00:00-05:10; the Reflection runs Wed. Load is the overlap with demo's running
// time, never with the [since, until] window, so a later rollout is no load.
test('load: a Reflection run long after the rollout never counts a later same-host rollout', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', byTs(life('a', { from: at('00:00'), to: at('02:00'), c: 2, lane: [at('02:00'), at('02:10')] })))
  emitAll(home, 'other', byTs(life('z', { from: D(6, '00:00'), to: D(6, '05:00'), c: 2, lane: [D(6, '05:00'), D(6, '05:10')] })))
  emitAll(home, 'during', byTs(life('y', { from: at('01:00'), to: at('04:00'), c: 2 })))
  const out = scored(home, ['--until', D(7, '00:00')])
  assert.equal(out.runningTime.hours, 2.167)
  assert.deepEqual(out.load.rollouts.map((r) => [r.rollout, r.start, r.end, r.hours]), [['during', Z(at('01:00')), Z(at('02:10')), 1.167]],
    'only the overlap with demo\'s running time: other is no load, during counts up to 02:10')
})

// The 3.0.0 E2E's row 16: busy took two Slots at 00:00 and, its calls running long, wrote nothing after 00:25, so
// its last line precedes demo's run (01:00-01:40). Its Slots are still open, so it is load through the run. done
// freed its only Slot at 00:20 before the run began: no load. lost took a Slot on Sunday and never freed it: its
// span is bounded by this run's window, so it counts against this run and is flagged, never counted forever.
test('load: a quiet concurrent record with open Slots counts through the run; a freed one does not; a lost slot-freed is flagged', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', byTs(life('a', { from: at('01:00'), to: at('01:30'), c: 2, lane: [at('01:30'), at('01:40')] })))
  emitAll(home, 'busy', [
    [at('00:00'), 'slot-taken', 'p65-1', { settings: S(5), start: 'start' }],
    [at('00:00'), 'slot-taken', 'p66-1', { settings: S(5), start: 'start' }],
    [at('00:25'), 'run-bound', 'p66-1', { runId: 'wf_p66', journalDir: '/nonexistent/workflows', call: 'task' }],
  ])
  emitAll(home, 'done', byTs(life('y', { from: at('00:00'), to: at('00:20'), c: 2 })))
  emitAll(home, 'lost', [[D(4, '09:00'), 'slot-taken', 'q', { settings: S(1), start: 'start' }]])
  const out = scored(home, ['--until', D(7, '00:00')])
  assert.equal(out.runningTime.hours, 0.667)
  assert.deepEqual(out.load.rollouts.map((r) => [r.rollout, r.start, r.end, r.hours, r.slotsTaken, r.slotsOpen]), [
    ['busy', Z(at('01:00')), Z(at('01:40')), 0.667, 0, 2],
    ['lost', Z(at('01:00')), Z(at('01:40')), 0.667, 0, 1],
  ], 'busy and lost are live through the run on their open Slots; done is not')
  assert.ok(has(out.flags, /^load: \[\[busy\]\] has 2 Slot\(s\) with no slot-freed \(\[\[p65-1\]\], \[\[p66-1\]\]\): read as live past its last line \(2026-10-05T00:25:00\.000Z\) to this run's end; a lost slot-freed overcounts it$/), out.flags.join('\n'))
  assert.ok(has(out.flags, /^load: \[\[lost\]\] has 1 Slot\(s\) with no slot-freed \(\[\[q\]\]\)/))
  assert.ok(!has(out.flags, /\[\[done\]\]/))
})

test('reviews and tunings are refused as the scored rollout (exit 2)', (t) => {
  const home = tmpHome(t)
  for (const r of ['reviews', '[[tunings]]']) {
    const x = score(home, ['--until', at('03:00')], { rollout: r })
    assert.equal(x.status, 2, r)
    assert.match(x.stderr, /^score: rollout '(reviews|tunings)' is reserved/)
    assert.equal(x.stdout, '')
  }
})

test('an unparsable line is skipped and flagged', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', byTs(saturated(3)))
  fs.appendFileSync(path.join(evDir(home), 'demo.jsonl'), '{"v":1,"ts":"2026-10-05T0\n')
  const out = scored(home, ['--until', at('06:00')])
  assert.ok(has(out.flags, /^1 record line\(s\) did not parse: skipped$/))
  assert.equal(out.merges.count, 3)
})

test('--since/--until take +10/+11 offsets across the DST change; a naive stamp is exit 2', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', byTs([
    ...life('a', { from: '2026-10-03T14:00:00Z', to: '2026-10-03T17:00:00Z', c: 2, lane: ['2026-10-03T17:00:00Z', '2026-10-03T17:10:00Z'] }),
  ]))
  // 2026-10-04 00:00+10:00 is 03T14:00Z; 04:10+11:00 is 03T17:10Z (Melbourne moved to +11 at 02:00 local)
  const out = scored(home, ['--since', '2026-10-04T00:00:00+10:00', '--until', '2026-10-04T04:10:00+11:00'])
  assert.equal(out.window.since, '2026-10-03T14:00:00.000Z')
  assert.equal(out.window.until, '2026-10-03T17:10:00.000Z')
  assert.equal(out.runningTime.hours, 3.167)
  const bad = score(home, ['--until', '2026-10-04T04:10:00'])
  assert.equal(bad.status, 2)
  assert.match(bad.stderr, /^score: ts .* has no offset or Z\n$/)
})

test('null repo: nothing proposed, flagged', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', slotBound())
  const out = scored(home, ['--until', at('12:00'), '--settings', writeSettings(home, { parallel_ceiling: 3 }, { repo: null })])
  assert.equal(out.repo, null)
  assert.equal(out.binding.constraint, 'slot-bound')
  assert.deepEqual(out.proposals, [])
  assert.deepEqual(out.withheld, [])
  assert.ok(has(out.flags, /^no repo identity \(no GitHub origin\): nothing to tune, no baseline kept$/))
})

test('a --note given as the --rollout path is read; an unreadable --note is exit 1', (t) => {
  const home = tmpHome(t)
  const note = writeNote(home, { parallel_ceiling: 5, captured: '2026-10-04' })
  emitAll(home, 'demo-rollout-2026-10-04', byTs(saturated(5)))
  const out = scored(home, ['--until', at('06:00'), '--settings', writeSettings(home, { parallel_ceiling: 3 })], { rollout: note })
  assert.equal(out.rollout, 'demo-rollout-2026-10-04')
  assert.equal(out.proposals[0].ranAtCause, 'ran at 5 by a rollout-note override; rollouts.toml has said 3 since before this rollout was scheduled')
  const bad = score(home, ['--note', path.join(home, 'missing.md')])
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /^score: cannot read --note /)
})

test('score.py and the escapes.py it loads parse as python 3.8, and score.py writes nothing into the events dir', (t) => {
  for (const script of [SCORE, ESCAPES]) {
    const r = spawnSync('python3', ['-B', '-c', 'import ast, sys\nast.parse(open(sys.argv[1]).read(), sys.argv[1], feature_version=(3, 8))', script], { encoding: 'utf8' })
    assert.equal(r.status, 0, `${path.basename(script)}: ${r.stderr}`)
  }
  const home = tmpHome(t)
  emitAll(home, 'demo', byTs(saturated(3)))
  const before = fs.readdirSync(evDir(home)).map((f) => [f, fs.readFileSync(path.join(evDir(home), f), 'utf8')])
  scored(home, ['--until', at('06:00'), '--settings', writeSettings(home, { parallel_ceiling: 3 })])
  assert.deepEqual(fs.readdirSync(evDir(home)).map((f) => [f, fs.readFileSync(path.join(evDir(home), f), 'utf8')]), before)
})

// ---- Review churn (p21-3, ADR 0037 d1) ----------------------------------------------------------------------------
// Engine rounds are the record's review-verdict lines (reconcile-rollout.py writes one per judged master-review round);
// /fresh-review rounds are reviews.jsonl's review-round lines (p15-7). Churn = Σregression / Σfindings over both.

const rv = (ts, task, round, verdict, findings, original, regression, extra = {}) =>
  [ts, 'review-verdict', task, { round, verdict, findings, original, regression, digest: `d-${task}-${round}`, ...extra }]
const rr = (ts, fields) => [ts, 'review-round', null, fields, null]

// t1: r1 changes (3 original), r2 changes (2 regression, answering r1's fix), r3 approve; merged. Head-less, so each
// line's identity is its digest.
function churnFixture() {
  return byTs([
    ...life('t1', { from: at('00:00'), to: at('02:00'), c: 2, lane: [at('02:00'), at('02:10')] }),
    rv(at('00:30'), 't1', 1, 'changes', 3, 3, 0),
    rv(at('01:00'), 't1', 2, 'changes', 2, 0, 2),
    rv(at('01:30'), 't1', 3, 'approve', 0, 0, 0),
  ])
}

test('(a) review churn: a round that only answers the last round\'s fix scores churn > 0, with rounds per landed task', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', churnFixture())
  const out = scored(home, ['--until', at('06:00'), '--repo-slug', 'o/r'])
  assert.equal(out.reviewChurn.value, 0.4)
  assert.deepEqual([out.reviewChurn.findings, out.reviewChurn.original, out.reviewChurn.regression, out.reviewChurn.unclassified, out.reviewChurn.rounds], [5, 3, 2, 0, 3])
  assert.deepEqual(out.reviewChurn.engine, { rounds: 3, findings: 5, original: 3, regression: 2, unclassified: 0, landedTasks: 1, roundsPerLandedTask: 3 })
  assert.deepEqual(out.reviewChurn.freshReview, { rounds: 0, findings: 0, original: 0, regression: 0, unclassified: 0, unattributed: 0 })
  assert.deepEqual(out.guardrails.reviewChurn, { value: 0.4, bound: '<=40%', baseline: null, breached: false, roundsPerLandedTask: 3 })
  assert.ok(!has(out.flags, /review churn unknown/))
})

test('(b) review churn: a one-round task approved first time scores 0.0, not null', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', byTs([...life('t1', { from: at('00:00'), to: at('02:00'), c: 2, lane: [at('02:00'), at('02:10')] }),
    rv(at('01:00'), 't1', 1, 'approve', 0, 0, 0)]))
  const out = scored(home, ['--until', at('06:00'), '--repo-slug', 'o/r'])
  assert.equal(out.reviewChurn.value, 0)
  assert.equal(out.reviewChurn.engine.roundsPerLandedTask, 1)
  assert.equal(out.guardrails.reviewChurn.value, 0)
  assert.equal(out.guardrails.reviewChurn.breached, false)
})

test('(c) review churn: no round recorded reads as unknown, never 0', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', byTs(life('t1', { from: at('00:00'), to: at('02:00'), c: 2, lane: [at('02:00'), at('02:10')] })))
  const out = scored(home, ['--until', at('06:00'), '--repo-slug', 'o/r'])
  assert.equal(out.reviewChurn.value, null)
  assert.equal(out.reviewChurn.rounds, 0)
  assert.equal(out.guardrails.reviewChurn.value, 'unknown')
  assert.equal(out.guardrails.reviewChurn.breached, false, 'a null guardrail never breaches')
  assert.ok(has(out.flags, /^review churn unknown: no review rounds recorded$/))
  assert.ok(has(out.flags, /^review churn: landed task\(s\) with no recorded review round: \[\[t1\]\]/))
  assert.equal(out.reviewChurn.engine.roundsPerLandedTask, null)
})

function gitOrigin(dir, url) {
  fs.mkdirSync(dir, { recursive: true })
  for (const args of [['init', '-q', dir], ['-C', dir, 'remote', 'add', 'origin', url]]) {
    const r = spawnSync('git', args, { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir, GIT_CONFIG_NOSYSTEM: '1' } })
    assert.equal(r.status, 0, r.stderr)
  }
  return dir
}

test('(d) review churn: /fresh-review rounds are attributed by repo (owner/name or path), deduped on (repo, doc) else (repo, head, digest)', (t) => {
  const home = tmpHome(t)
  const clone = gitOrigin(path.join(home, 'clone'), 'https://github.com/O/R.git')
  const other = gitOrigin(path.join(home, 'other'), 'git@github.com:o/other.git')
  emitAll(home, 'demo', byTs(life('t1', { from: at('00:00'), to: at('02:00'), c: 2, lane: [at('02:00'), at('02:10')] })))
  const c = (findings, original, regression) => ({ findings, original, regression })
  emitAll(home, 'x', [
    rr(at('00:10'), { repo: 'O/R', head: 'h1', digest: 'g1', doc: 'docs/reviews/a.md', ...c(4, 4, 0) }),
    rr(at('00:20'), { repo: 'O/R', head: 'h1', digest: 'g1', doc: 'docs/reviews/a.md', ...c(4, 3, 1) }), // same (repo, doc): the latest kept
    rr(at('00:30'), { repo: 'O/R', head: 'h2', digest: 'g2', doc: 'docs/reviews/b.md', ...c(2, 0, 2) }),
    rr(at('00:31'), { repo: 'O/R', head: 'h2', digest: 'g2', doc: 'docs/reviews/c.md', ...c(2, 0, 2) }), // another doc: a round of its own
    rr(at('00:40'), { repo: clone, head: 'h3', digest: 'g3', ...c(1, 1, 0) }), // by path
    rr(at('00:41'), { repo: clone, head: 'h3', digest: 'g3', ...c(1, 1, 0) }), // doc-less duplicate: collapses
    rr(at('00:50'), { repo: path.join(clone, '.claude', 'worktrees', 'gone'), head: 'h4', digest: 'g4', ...c(2, 1, 0) }), // a deleted worktree
    rr(at('01:00'), { repo: 'o/other', head: 'h5', digest: 'g5', ...c(9, 0, 9) }), // another repo
    rr(at('01:01'), { repo: other, head: 'h6', digest: 'g6', ...c(9, 0, 9) }), // another repo by path
    // swept into the window at a landing's end, but reviewed long before it: its round is not this window's
    rr(at('01:10'), { repo: 'O/R', head: 'h7', digest: 'g7', doc: 'docs/reviews/old.md', reviewedAt: '2026-01-01T00:00:00.000Z', ...c(8, 0, 8) }),
  ])
  // a.md's latest (4: 3 original, 1 regression), b.md and c.md (2 regression each), the clone (1 original) and the
  // deleted worktree (2: 1 original, 1 unclassified); o/other and the other clone are another repo's
  const bySlug = scored(home, ['--until', at('06:00'), '--repo-slug', 'o/r'])
  assert.deepEqual(bySlug.reviewChurn.freshReview, { rounds: 5, findings: 11, original: 5, regression: 5, unclassified: 1, unattributed: 0 })
  assert.equal(bySlug.reviewChurn.value, 0.4545)
  const bySettings = scored(home, ['--until', at('06:00'), '--settings', writeSettings(home, {}, { repo: 'o/r' })])
  assert.deepEqual(bySettings.reviewChurn.freshReview, bySlug.reviewChurn.freshReview, '--settings\' repo with no --repo-slug')
  const none = scored(home, ['--until', at('06:00')])
  assert.deepEqual(none.reviewChurn.freshReview, { rounds: 0, findings: 0, original: 0, regression: 0, unclassified: 0, unattributed: 7 })
  assert.equal(none.reviewChurn.value, null)
  assert.ok(has(none.flags, /^review churn: 7 \/fresh-review round\(s\) in reviews\.jsonl could not be attributed/))
})

test('(e) review churn: one verdict_key dedupe feeds both the sums and rounds per landed task', (t) => {
  // a replayed head-less r1 (same digest, later ts: what a signed-gate resume writes when the writer skip is bypassed)
  const home = tmpHome(t)
  emitAll(home, 'demo', byTs([...churnFixture(), rv(at('01:45'), 't1', 1, 'changes', 3, 3, 0)]))
  const out = scored(home, ['--until', at('06:00'), '--repo-slug', 'o/r'])
  assert.equal(out.reviewChurn.value, 0.4)
  assert.equal(out.reviewChurn.engine.rounds, 3)
  assert.equal(out.reviewChurn.engine.roundsPerLandedTask, 3, 'not 4')
  // two r1 lines with the same head and different digests: one round, the first line's findings
  const same = tmpHome(t)
  emitAll(same, 'demo', byTs([...life('t1', { from: at('00:00'), to: at('02:00'), c: 2, lane: [at('02:00'), at('02:10')] }),
    rv(at('00:30'), 't1', 1, 'changes', 4, 2, 2, { head: 'a'.repeat(40), digest: 'first' }),
    rv(at('00:40'), 't1', 1, 'changes', 1, 1, 0, { head: 'a'.repeat(40), digest: 'second' })]))
  const s = scored(same, ['--until', at('06:00'), '--repo-slug', 'o/r'])
  assert.deepEqual([s.reviewChurn.engine.rounds, s.reviewChurn.engine.findings, s.reviewChurn.value, s.reviewChurn.engine.roundsPerLandedTask], [1, 4, 0.5, 1])
  // two head-less r1 lines with different digests (a fresh re-judge after a cache miss): two rounds, both counted
  const two = tmpHome(t)
  emitAll(two, 'demo', byTs([...life('t1', { from: at('00:00'), to: at('02:00'), c: 2, lane: [at('02:00'), at('02:10')] }),
    rv(at('00:30'), 't1', 1, 'changes', 4, 2, 2, { digest: 'one' }),
    rv(at('00:40'), 't1', 1, 'changes', 1, 1, 0, { digest: 'two' })]))
  const w = scored(two, ['--until', at('06:00'), '--repo-slug', 'o/r'])
  assert.deepEqual([w.reviewChurn.engine.rounds, w.reviewChurn.engine.findings, w.reviewChurn.engine.roundsPerLandedTask], [2, 5, 2])
})

// A Slot-bound run (saturated(3)) whose t1 review rounds churned 50%.
const churned = () => byTs([...saturated(3), rv(at('01:00'), 't1', 1, 'changes', 2, 1, 1)])

test('(f) review churn: 50% against the 40% bound is breached, and a raise is withheld naming it', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', churned())
  const out = scored(home, ['--until', at('06:00'), '--settings', writeSettings(home, { parallel_ceiling: 3 })])
  assert.equal(out.binding.constraint, 'slot-bound')
  assert.deepEqual(out.guardrails.reviewChurn, { value: 0.5, bound: '<=40%', baseline: null, breached: true, roundsPerLandedTask: 1 })
  assert.deepEqual(out.proposals, [])
  assert.match(out.withheld[0].reason, /^a raise while a Guardrail is breached: reviewChurn 0\.5 \(baseline None, bound <=40%\)$/)
  assert.ok(has(out.flags, /^review churn: landed task\(s\) with no recorded review round: \[\[t2\]\], \[\[t3\]\]/))
  signsHold(out)
})

test('(g) review churn: [guardrails] review_churn_pct 60 raises the bound, and the raise is proposed', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', churned())
  const out = scored(home, ['--until', at('06:00'), '--settings', writeSettings(home, { parallel_ceiling: 3 }, { guardrails: { review_churn_pct: 60 } })])
  assert.deepEqual(out.guardrails.reviewChurn, { value: 0.5, bound: '<=60%', baseline: null, breached: false, roundsPerLandedTask: 1 })
  assert.equal(out.proposals[0].key, 'parallel_ceiling')
})

test('(h) the p21-2 hand-off: the headline\'s reviewChurn slot carries reviewChurn.value', (t) => {
  // p21-2 gave the headline (tune.py's `scores`) a reviewChurn slot and landed second, so it wired the slot: the
  // tripwire p21-3 left is now a plain assertion, never vacuous.
  const home = tmpHome(t)
  emitAll(home, 'demo', churnFixture())
  const out = scored(home, ['--until', at('06:00'), '--repo-slug', 'o/r'])
  assert.ok('reviewChurn' in out.headline, JSON.stringify(out.headline))
  assert.equal(out.reviewChurn.value, 0.4)
  assert.equal(out.headline.reviewChurn, out.reviewChurn.value)
})

// t1 merged, with review-verdict lines given as [hh:mm, round, verdict, findings, original, regression]
const landedWith = (...verdicts) => byTs([...life('t1', { from: at('00:00'), to: at('02:00'), c: 2, lane: [at('02:00'), at('02:10')] }),
  ...verdicts.map(([ts, round, verdict, f, o, r]) => rv(at(ts), 't1', round, verdict, f, o, r))])

test('(i) review churn: findings none of which was classified read as unknown, never 0, and never breach', (t) => {
  // a head-less round (or no tree, or no path:line cite): 3 findings, 0 original, 0 regression
  const home = tmpHome(t)
  emitAll(home, 'demo', landedWith(['00:30', 1, 'changes', 3, 0, 0], ['01:00', 2, 'approve', 0, 0, 0]))
  const out = scored(home, ['--until', at('06:00'), '--settings', writeSettings(home, {}, { guardrails: { review_churn_pct: 0 } })])
  assert.equal(out.reviewChurn.value, null)
  assert.deepEqual([out.reviewChurn.findings, out.reviewChurn.original, out.reviewChurn.regression, out.reviewChurn.unclassified, out.reviewChurn.rounds], [3, 0, 0, 3, 2])
  assert.equal(out.guardrails.reviewChurn.value, 'unknown')
  assert.equal(out.guardrails.reviewChurn.breached, false, 'unknown never breaches, not even a 0% bound')
  assert.ok(has(out.flags, /^review churn unknown: 3 finding\(s\), none classified \(no head, no tree or no path:line cite\)$/))
  assert.ok(!has(out.flags, /no review rounds recorded/))
  assert.ok(!has(out.flags, /low coverage/), 'the unknown flag says it, once')
})

test('(j) review churn: more than half the findings unclassified is flagged low coverage; half is not', (t) => {
  const low = tmpHome(t)
  emitAll(low, 'demo', landedWith(['00:30', 1, 'changes', 5, 1, 1]))
  const l = scored(low, ['--until', at('06:00'), '--repo-slug', 'o/r'])
  assert.equal(l.reviewChurn.value, 0.2)
  assert.equal(l.reviewChurn.unclassified, 3)
  assert.ok(has(l.flags, /^review churn: low coverage: 3 of 5 finding\(s\) unclassified \(no head, no tree or no path:line cite\)/))
  const half = tmpHome(t)
  emitAll(half, 'demo', landedWith(['00:30', 1, 'changes', 4, 1, 1]))
  const h = scored(half, ['--until', at('06:00'), '--repo-slug', 'o/r'])
  assert.equal(h.reviewChurn.value, 0.25)
  assert.ok(!has(h.flags, /low coverage/))
})

test('(k) review churn: the breach is decided from the integer sums, not the rounded fraction', (t) => {
  const breach = (bound, f, o, r) => {
    const home = tmpHome(t)
    emitAll(home, 'demo', landedWith(['00:30', 1, 'changes', f, o, r]))
    return scored(home, ['--until', at('06:00'), '--settings', writeSettings(home, {}, { guardrails: { review_churn_pct: bound } })]).guardrails.reviewChurn
  }
  // exactly at the bound: 11/20 * 100 is 55.00000000000001 and 7/25 * 100 is 28.000000000000004 in floats
  assert.deepEqual(breach(55, 20, 9, 11), { value: 0.55, bound: '<=55%', baseline: null, breached: false, roundsPerLandedTask: 1 })
  assert.equal(breach(28, 25, 18, 7).breached, false, '7 of 25 is at a 28% bound')
  assert.equal(breach(55, 20, 8, 12).breached, true, 'one over the bound breaches')
  // a decimal bound reads as the decimal it prints as: 141 of 1000 is at 14.1%, 142 is over
  assert.equal(breach(14.1, 1000, 859, 141).breached, false)
  assert.equal(breach(14.1, 1000, 858, 142).breached, true)
  // 4-place rounding cannot hide a breach: 40001/100001 rounds to 0.4, yet it is over 40%
  const over = breach(40, 100001, 60000, 40001)
  assert.deepEqual([over.value, over.breached], [0.4, true])
})

// ---- the weekly reading's reads (p21-7, ADR 0037 d5) ----------------------------------------------------------------
// ranAt is each key's ran-at value, computed once; a spread is flagged only for a key a proposal uses. An auto line's
// applied entries (with agreed) count like a pick's; a close line adds nothing. landed_from is the landed set's one rule.

test('ranAt holds the ceiling and each cap, a spread included; a spread on an unproposed key adds no flag', (t) => {
  const home = tmpHome(t)
  const caps = [4, 4, 6]
  emitAll(home, 'demo', byTs(saturated(3, { settings: (i) => S(3, { max_review_rounds: caps[i], max_iterations: 2 }) })))
  const out = scored(home, ['--until', at('06:00'), '--settings', writeSettings(home, { parallel_ceiling: 3 })])
  assert.deepEqual(out.ranAt, { parallel_ceiling: 3, max_review_rounds: 4, max_iterations: 2, max_plan_rounds: 3 })
  assert.ok(!out.proposals.concat(out.withheld).some((p) => p.key === 'max_review_rounds'), 'no review-rounds proposal')
  assert.ok(!has(out.flags, /task override/), `no spread flag for an unproposed key: ${JSON.stringify(out.flags)}`)
})

test('an auto line with agreed gives the same agreeing, ranAtCause and baseline as a pick line; a close line adds nothing', (t) => {
  const run = (over) => {
    const home = tmpHome(t)
    emitAll(home, 'demo', byTs(saturated(3)))
    emitAll(home, 'older-run', [[at('02:00'), 'tuning', null, {
      id: 't-prior', repo: 'o/r', window: { since: D(4, '00:00'), until: D(4, '10:00'), activeStart: D(4, '00:00'), activeEnd: D(4, '09:00'), partial: false },
      scores: SC(), applied: [{ key: 'parallel_ceiling', from: 3, to: 4, ranAt: 3, rule: 'slot-bound-raise', evidence: 'Slot-bound', agreeing: 0 }],
      ...over,
    }]])
    const out = scored(home, ['--until', at('06:00'), '--settings', writeSettings(home, { parallel_ceiling: 4 })])
    const [w] = out.withheld
    return [w.agreeing, w.ranAtCause, out.baseline && out.baseline.id]
  }
  const pick = run({})
  assert.deepEqual(pick, [1, `Tuning t-prior moved it on ${Z(at('02:00'))}`, 't-prior'])
  const auto = run({ auto: true, reflection: 'r-20261005T000000Z-abcdef',
    applied: [{ key: 'parallel_ceiling', from: 3, to: 4, ranAt: 3, rule: 'slot-bound-raise', evidence: 'Slot-bound', agreeing: 2, agreed: 3 }] })
  assert.deepEqual(auto, pick)
  const close = run({ applied: [], close: 'completion' })
  assert.equal(close[0], 0, 'a close line\'s empty applied never agrees')
  assert.equal(close[2], 't-prior', 'and it still serves as the baseline')
})

test('landed_from: the same escapes.landed and pr-conflict flag as the score, and a pure function', (t) => {
  const home = tmpHome(t)
  const ev = life('t1', { from: at('00:00'), to: at('02:00'), c: 2, lane: [at('02:00'), at('02:10')] })
  ev.push([at('02:20'), 'merged', 't1', { pr: 8 }])
  emitAll(home, 'demo', byTs([...ev, ...life('t2', { from: at('00:00'), to: at('02:00'), c: 2, lane: [at('02:10'), at('02:30')] })]))
  const out = scored(home, ['--until', at('06:00'), '--settings', writeSettings(home, { parallel_ceiling: 2 })])
  assert.equal(out.escapes.landed, out.merges.count)
  assert.ok(has(out.flags, /^escapes: \[\[t1\]\]'s merged lines carry 2 different prs \(7, 8\): the latest is read$/), JSON.stringify(out.flags))
  const body = ['import importlib.util, json, sys', 'spec = importlib.util.spec_from_file_location("s", sys.argv[1])',
    's = importlib.util.module_from_spec(spec); spec.loader.exec_module(s)',
    'print(json.dumps(s.landed_from([(1, "a", 7, False), (2, "a", None, False), (3, "b", "#9", True), (9, "c", 1, False)], 0, 5)))'].join('\n')
  const r = spawnSync('python3', ['-B', '-c', body, SCORE], { encoding: 'utf8', cwd: home, env: baseEnv(home) })
  assert.equal(r.status, 0, r.stderr)
  const [landed, flags] = JSON.parse(r.stdout)
  assert.deepEqual(Object.keys(landed).sort(), ['a', 'b'])
  assert.deepEqual([landed.a.pr, landed.b.readOnly, flags], [7, true, []])
})
