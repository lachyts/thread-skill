// skills/retro/scripts/score.py — a Retro's scoring script (p15-5, ADR 0032): Throughput over running time,
// the Guardrails against a baseline, Slot and lane utilisation, load, the binding constraint and the proposals.
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
const SCORE = path.join(root, 'skills', 'retro', 'scripts', 'score.py')
const RUN_RECORD = path.join(root, 'skills', '_shared', 'scripts', 'run_record.py')

// ---- helpers ----------------------------------------------------------------------------------------------

function tmpHome(t) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'retro-score-')))
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
  const g = { tokens_per_merge_pct: 25, set_aside_rate_points: 5, conflict_rate_points: 10, quota_stalls: 0, ...guardrails }
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
  assert.deepEqual(out.headline, { throughput: 0.857, runningHours: 7, merges: 6, tokensPerMerge: 100000, setAsideRate: 0, conflictRate: 0, quotaStalls: 0 })
  assert.equal(out.proposals.length, 1)
  const [p] = out.proposals
  assert.deepEqual([p.id, p.key, p.from, p.to, p.ranAt, p.ranAtCause, p.rule, p.direction, p.agreeing], ['p1', 'parallel_ceiling', 3, 4, 3, null, 'slot-bound-raise', 1, 0])
  assert.match(p.evidence, /^Slot-bound: Slots full 71% of 7\.0 running h at ceiling 3; lane 38% busy/)
  assert.ok(p.evidence.length <= 300)
  assert.deepEqual(out.withheld, [])
  assert.ok(has(out.flags, /no baseline/), 'the first Retro on a repo has no baseline')
  signsHold(out)
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
    scores: { throughput: 1, runningHours: 9, merges: 9, tokensPerMerge: null, setAsideRate: 0, conflictRate: 0, quotaStalls: 0 },
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

// ---- 4. the baseline ----------------------------------------------------------------------------------------------

const SC = (over = {}) => ({ throughput: 1, runningHours: 4, merges: 4, tokensPerMerge: 100000, setAsideRate: 0.1, conflictRate: 0, quotaStalls: 0, ...over })
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
  assert.equal(out.headline.setAsideRate, 0.3333)
  assert.equal(out.guardrails.setAsideRate.baseline, 0.1)
  assert.equal(out.guardrails.setAsideRate.breached, true)
  assert.deepEqual(out.proposals, [])
  assert.match(out.withheld[0].reason, /^a raise while a Guardrail is breached: setAsideRate 0\.3333 \(baseline 0\.1, bound \+5 points\)$/)
  assert.ok(!has(out.flags, /no baseline/))
})

test('baseline: a late Retro (its line stamped after the next run began) still serves, on its active span', (t) => {
  const home = tmpHome(t)
  // Run B starts Tue 09:00; run A was active until Mon 18:00 and its Retro ran Tue 12:00.
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
  assert.ok(!has(out.flags, /partial Retro/))

  const home2 = tmpHome(t)
  emitAll(home2, 'demo', byTs(saturated(3)))
  emitAll(home2, 'x', [
    tuningLine(D(4, '21:00'), 't-partial', [D(4, '10:00'), D(4, '21:00'), D(4, '10:00'), D(4, '21:00'), true]),
    tuningLine(D(4, '23:00'), 't-null', [D(4, '22:00'), D(4, '23:00'), null, null]),
  ])
  const out2 = scored(home2, ['--until', at('06:00'), '--settings', writeSettings(home2, { parallel_ceiling: 3 })])
  assert.equal(out2.baseline.id, 't-partial')
  assert.ok(has(out2.flags, /^baseline: only a partial Retro's line qualifies \(t-partial\)/))

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
})

test('no record: an empty score, flagged, exit 0', (t) => {
  const home = tmpHome(t)
  const out = scored(home, ['--until', at('03:00'), '--repo-slug', 'o/r'])
  assert.ok(has(out.flags, /^no record$/))
  assert.deepEqual(out.headline, { throughput: null, runningHours: 0, merges: 0, tokensPerMerge: null, setAsideRate: null, conflictRate: null, quotaStalls: 0 })
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

// demo ran Mon 00:00-02:10; other ran Tue 00:00-05:10; the Retro runs Wed. Load is the overlap with demo's running
// time, never with the [since, until] window, so a later rollout is no load.
test('load: a Retro run long after the rollout never counts a later same-host rollout', (t) => {
  const home = tmpHome(t)
  emitAll(home, 'demo', byTs(life('a', { from: at('00:00'), to: at('02:00'), c: 2, lane: [at('02:00'), at('02:10')] })))
  emitAll(home, 'other', byTs(life('z', { from: D(6, '00:00'), to: D(6, '05:00'), c: 2, lane: [D(6, '05:00'), D(6, '05:10')] })))
  emitAll(home, 'during', byTs(life('y', { from: at('01:00'), to: at('04:00'), c: 2 })))
  const out = scored(home, ['--until', D(7, '00:00')])
  assert.equal(out.runningTime.hours, 2.167)
  assert.deepEqual(out.load.rollouts.map((r) => [r.rollout, r.start, r.end, r.hours]), [['during', Z(at('01:00')), Z(at('02:10')), 1.167]],
    'only the overlap with demo\'s running time: other is no load, during counts up to 02:10')
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

test('score.py parses as python 3.8 and writes nothing into the events dir', (t) => {
  const r = spawnSync('python3', ['-B', '-c', 'import ast, sys\nast.parse(open(sys.argv[1]).read(), sys.argv[1], feature_version=(3, 8))', SCORE], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const home = tmpHome(t)
  emitAll(home, 'demo', byTs(saturated(3)))
  const before = fs.readdirSync(evDir(home)).map((f) => [f, fs.readFileSync(path.join(evDir(home), f), 'utf8')])
  scored(home, ['--until', at('06:00'), '--settings', writeSettings(home, { parallel_ceiling: 3 })])
  assert.deepEqual(fs.readdirSync(evDir(home)).map((f) => [f, fs.readFileSync(path.join(evDir(home), f), 'utf8')]), before)
})
