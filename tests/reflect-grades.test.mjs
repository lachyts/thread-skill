// skills/reflect/scripts/grades.py — the Grade log's reader (p25-4, ADR 0041; CONTEXT.md **Grade log**): each grade
// line's episode, its dispatch, acts and outcome, each grade's hands-off rate over the window and over every closed
// episode, and Slot hours per size. Every rule lives in grades.py's docstring; this pins the behaviour.
//
// Hermetic: each case gets its own mkdtemp HOME, THREAD_EVENTS_DIR and --tasks-dir, TZ pinned to Melbourne and an env
// built from scratch that every spawn passes. Grade lines and record lines both go through run_record.emit in one python
// process per fixture, so every fixture line is one run_record would write. The CLI runs over the window below.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GRADES_PY = path.join(root, 'skills', 'reflect', 'scripts', 'grades.py')
const RUN_RECORD = path.join(root, 'skills', '_shared', 'scripts', 'run_record.py')

// The window: a past week in Melbourne (AEST, +10:00), so since's date is 2026-09-03 and until's 2026-09-10.
const SINCE = '2026-09-03T00:00+10:00'
const UNTIL = '2026-09-10T00:00+10:00'
const W = (d, hm) => `2026-09-0${d}T${hm}:00Z` // a UTC stamp, inside the window for d in 3..8
const SETTINGS = { settings: { parallel_ceiling: 2 }, start: 'start' }

function setup(t) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'reflect-grades-')))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const h = { home, tasks: path.join(home, 'Tasks'), ev: path.join(home, 'events'), n: 0 }
  fs.mkdirSync(path.join(h.tasks, 'Archive', '2026'), { recursive: true })
  fs.mkdirSync(h.ev, { recursive: true })
  return h
}
const env = (h) => ({ PATH: process.env.PATH, HOME: h.home, PYTHONDONTWRITEBYTECODE: '1', TZ: 'Australia/Melbourne',
  THREAD_EVENTS_DIR: h.ev })

// Every line through run_record.emit(strict=True): [ts, kind, task, fields, rollout] (a grade's rollout is null).
function emitAll(h, rows) {
  const body = ['import importlib.util, json, sys', 'spec = importlib.util.spec_from_file_location("run_record", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'for ts, kind, task, fields, r in json.load(sys.stdin):', '    assert m.emit(r, kind, task, fields, ts=ts, strict=True), (kind, task, ts)'].join('\n')
  const r = spawnSync('python3', ['-B', '-c', body, RUN_RECORD], { encoding: 'utf8', cwd: h.home, env: env(h), input: JSON.stringify(rows) })
  assert.equal(r.status, 0, r.stderr)
}

// A grade line, as estate-dispatch.py log writes it: one pass per call unless `pass` is given.
function grade(h, task, ts, fields = {}) {
  const pass = fields.pass ?? `g-20260901T000000Z-${String(++h.n).padStart(6, '0')}`
  return [ts, 'grade', task, { pass, digest: '0123456789ab', project: 'Proj', grade: 'Ready', agentGrade: 'Ready',
    shape: 'parallel', size: 'S', decisions: 0, low: 0, held: false, gates: [], ...fields, pass }, null]
}
const line = (rollout) => (ts, kind, task, fields = {}) => [ts, kind, task, fields, rollout]
// A task's run in one rollout: a Slot from..to, then a lane holding and its merge at `merged` (null: no merge).
function run(rollout, task, from, to, merged = null) {
  const L = line(rollout)
  const out = [L(from, 'slot-taken', task, SETTINGS), L(to, 'slot-freed', task, { outcome: merged ? 'ready' : 'set-aside' })]
  if (merged) out.push(L(to, 'ready', task, { pr: 7 }), L(to, 'lane-taken', task), L(merged, 'lane-freed', task, { release: 'merge' }),
    L(merged, 'merged', task, { pr: 7 }))
  return out
}

function note(h, slug, { status = 'open', rollout = null, merged = null, completed = null, body = '' } = {}) {
  const fm = ['---', 'tags: [task, ai]', `status: ${status}`]
  if (rollout) fm.push(`rollout: "[[${rollout}]]"`)
  if (merged) fm.push(`merged: ${merged}`)
  if (completed) fm.push(`completed: ${completed}`)
  fs.writeFileSync(path.join(h.tasks, `${slug}.md`), [...fm, '---', '', `# ${slug}`, '', body, ''].join('\n'))
}

function grades(h, { since = SINCE, until = UNTIL } = {}) {
  const r = spawnSync('python3', ['-B', GRADES_PY, '--since', since, '--until', until, '--tasks-dir', h.tasks],
    { encoding: 'utf8', cwd: h.home, env: env(h) })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}
const eps = (out, task) => out.grades.episodes.filter((e) => e.task === task)
const one = (out, task) => { const e = eps(out, task); assert.equal(e.length, 1, `${task}: ${JSON.stringify(e)}`); return e[0] }

// ---- the module ------------------------------------------------------------------------------------------------------

test('grades.py parses as python 3.9 and loads with no yaml and nothing outside the stdlib and the plugin', (t) => {
  const r = spawnSync('python3', ['-B', '-c', 'import ast, sys\nast.parse(open(sys.argv[1]).read(), sys.argv[1], feature_version=(3, 9))', GRADES_PY], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const h = setup(t)
  const body = ['import importlib.util, sys', 'sys.modules["yaml"] = None', 'base = set(sys.modules)',
    'spec = importlib.util.spec_from_file_location("g", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'extra = sorted(n for n in set(sys.modules) - base if n.split(".")[0] not in sys.stdlib_module_names and not n.startswith("thread_") and n != "g")',
    'print(extra)'].join('\n')
  const load = spawnSync('python3', ['-B', '-c', body, GRADES_PY], { encoding: 'utf8', cwd: h.home, env: env(h) })
  assert.equal(load.status, 0, load.stderr)
  assert.equal(load.stdout.trim(), '[]')
})

test('no grades.jsonl: an empty block and the flag, never an error; a torn line is skipped and counted', (t) => {
  const h = setup(t)
  const out = grades(h)
  assert.ok(out.flags.includes('no grade log'), JSON.stringify(out.flags))
  assert.equal(out.grades.log.exists, false)
  assert.deepEqual(out.grades.episodes, [])
  assert.equal(out.grades.window.readyHandsOff.rate, null)
  assert.deepEqual(Object.keys(out.grades.window.byGrade), ['Ready', 'One call', 'Grill', 'Orient'])
  emitAll(h, [grade(h, 'a', W(3, '00:00'))])
  fs.appendFileSync(path.join(h.ev, 'grades.jsonl'), '{"v":1,"ts":"2026-09-03T01:00:00.000Z","kind":"grade","task":"b"')
  note(h, 'a')
  const torn = grades(h)
  assert.ok(torn.flags.includes('1 line(s) of grades.jsonl did not parse: skipped'), JSON.stringify(torn.flags))
  assert.deepEqual([torn.grades.log.lines, torn.grades.log.torn, torn.grades.log.tasks], [1, 1, 1])
  assert.deepEqual([torn.grades.pending.total, torn.grades.episodes], [1, []], 'a pending episode is a count alone')
})

// ---- outcomes --------------------------------------------------------------------------------------------------------

test('Ready then merged with no act is hands-off; an act before the grade does not count; one after it bounces', (t) => {
  const h = setup(t)
  emitAll(h, [
    grade(h, 'a', W(3, '00:00')),
    ...run('r1', 'a', W(3, '01:00'), W(3, '02:00'), W(3, '03:00')),
    line('r1')(W(3, '00:30'), 'answer-recorded', 'b', { answerKind: 'decision' }),
    grade(h, 'b', W(3, '01:00')),
    ...run('r1', 'b', W(3, '04:00'), W(3, '05:00'), W(3, '06:00')),
    grade(h, 'c', W(3, '00:00')),
    ...run('r1', 'c', W(4, '01:00'), W(4, '02:00'), W(4, '04:00')),
    line('r1')(W(4, '03:00'), 'answer-recorded', 'c', { answerKind: 'needs-you', form: 'hand-back' }),
  ].sort((x, y) => Date.parse(x[0]) - Date.parse(y[0])))
  for (const s of ['a', 'b', 'c']) note(h, s, { status: 'done' })
  const out = grades(h)
  assert.deepEqual(['a', 'b', 'c'].map((s) => [one(out, s).outcome, one(out, s).dispatchedBy, one(out, s).end.kind, one(out, s).end.by]),
    [['hands-off', 'record', 'landed', 'record'], ['hands-off', 'record', 'landed', 'record'], ['bounced', 'record', 'landed', 'record']])
  assert.deepEqual(one(out, 'c').rollouts, ['r1'], 'rollouts: the record whose lines fall in the span')
  assert.deepEqual(one(out, 'b').acts, [], 'the answer before the grade is not the episode\'s')
  assert.deepEqual(one(out, 'c').acts.map((a) => [a.kind, a.counted]), [['answer', true]])
  const ready = out.grades.window.byGrade.Ready
  assert.deepEqual([ready.handsOff, ready.bounced, ready.rate, ready.byKind.answer], [2, 1, 0.6667, 1])
  assert.deepEqual(out.grades.window.readyHandsOff, { rate: 0.6667, handsOff: 2, dispatched: 3 })
  assert.equal(out.grades.window.byGrade['One call'].rate, null, 'nothing graded One call')
})

test('a Ready miss stays against Ready when the task is regraded: Ready bounced (rate 0), One call hands-off (rate 1)', (t) => {
  const h = setup(t)
  emitAll(h, [
    grade(h, 'd', W(3, '00:00')),
    ...run('r2', 'd', W(3, '01:00'), W(3, '03:00')),
    line('r2')(W(3, '02:00'), 'answer-recorded', 'd', { answerKind: 'decision' }),
    grade(h, 'd', W(5, '00:00'), { grade: 'One call', decisions: 1 }),
    ...run('r3', 'd', W(5, '01:00'), W(5, '02:00'), W(5, '03:00')),
  ].sort((x, y) => Date.parse(x[0]) - Date.parse(y[0])))
  note(h, 'd', { status: 'done', merged: '2026-09-05T13:00+10:00' })
  const out = grades(h)
  const [first, second] = eps(out, 'd')
  assert.deepEqual([first.grade, first.end.kind, first.outcome, first.acts.length], ['Ready', 'regraded', 'bounced', 1])
  assert.deepEqual([second.grade, second.end.kind, second.outcome, second.acts.length], ['One call', 'landed', 'hands-off', 0])
  const g = out.grades.window.byGrade
  assert.deepEqual([g.Ready.bounced, g.Ready.rate, g['One call'].handsOff, g['One call'].rate], [1, 0, 1, 1])
})

test('regraded after a dispatch with no act is regraded, in the rate; never dispatched is undispatched, out of it', (t) => {
  const h = setup(t)
  emitAll(h, [
    grade(h, 'e', W(3, '00:00')), ...run('r4', 'e', W(3, '01:00'), W(3, '02:00')), grade(h, 'e', W(6, '00:00')),
    grade(h, 'f', W(3, '00:00')), grade(h, 'f', W(6, '00:00')),
  ].sort((x, y) => Date.parse(x[0]) - Date.parse(y[0])))
  note(h, 'e')
  note(h, 'f')
  const out = grades(h)
  // episodes[] lists the rated ones alone: undispatched and pending are counts (every pass regrades every open task).
  assert.deepEqual(eps(out, 'e').map((e) => [e.outcome, e.rollouts]), [['regraded', ['r4']]])
  assert.deepEqual(eps(out, 'f'), [])
  const ready = out.grades.window.byGrade.Ready
  assert.deepEqual([ready.regraded, ready.undispatched, ready.handsOff, ready.rate], [1, 1, 0, 0])
  assert.deepEqual(out.grades.pending, { total: 2, byGrade: { Ready: 2, 'One call': 0, Grill: 0, Orient: 0 } })
})

test('dropped: with an act it is bounced, without one dropped, both in the rate', (t) => {
  const h = setup(t)
  emitAll(h, [
    grade(h, 'g', W(3, '00:00')), ...run('r5', 'g', W(3, '01:00'), W(3, '03:00')),
    line('r5')(W(3, '02:00'), 'answer-recorded', 'g', { answerKind: 'decision' }),
    grade(h, 'k', W(3, '00:00')), ...run('r5', 'k', W(3, '04:00'), W(3, '05:00')),
  ].sort((x, y) => Date.parse(x[0]) - Date.parse(y[0])))
  note(h, 'g', { status: 'dropped', completed: '2026-09-05' })
  note(h, 'k', { status: 'dropped', completed: '2026-09-05' })
  const out = grades(h)
  assert.deepEqual([one(out, 'g').outcome, one(out, 'g').end, one(out, 'k').outcome],
    ['bounced', { kind: 'dropped', at: null, date: '2026-09-05', by: 'note' }, 'dropped'])
  const ready = out.grades.window.byGrade.Ready
  assert.deepEqual([ready.bounced, ready.dropped, ready.rate], [1, 1, 0])
})

test('gates: a sign-off on a grade that named gates is foreseen, on one that named none it bounces; the Standing approval is no act', (t) => {
  const h = setup(t)
  const L = line('r6')
  emitAll(h, [
    grade(h, 'ga', W(3, '00:00'), { gates: ['credential'] }), ...run('r6', 'ga', W(3, '01:00'), W(3, '02:00'), W(3, '03:00')),
    grade(h, 'gb', W(3, '00:00'), { gates: ['spend'] }), ...run('r6', 'gb', W(3, '04:00'), W(3, '06:00'), W(3, '07:00')),
    L(W(3, '05:00'), 'gate-signed', 'gb', { standing: false, gates: 1 }),
    grade(h, 'gc', W(3, '00:00'), { gates: [] }), ...run('r6', 'gc', W(4, '04:00'), W(4, '06:00'), W(4, '07:00')),
    L(W(4, '05:00'), 'gate-signed', 'gc', { standing: false, gates: 1 }),
    grade(h, 'gd', W(3, '00:00'), { gates: ['spend'] }), ...run('r6', 'gd', W(5, '04:00'), W(5, '06:00'), W(5, '07:00')),
    L(W(5, '05:00'), 'gate-signed', 'gd', { standing: true, gates: 1 }),
  ].sort((x, y) => Date.parse(x[0]) - Date.parse(y[0])))
  note(h, 'ga', { status: 'done', body: '## Approved gates\n\n- credential: the deploy token (asked ahead at schedule)\n' })
  for (const s of ['gb', 'gc', 'gd']) note(h, s, { status: 'done' })
  const out = grades(h)
  assert.deepEqual(['ga', 'gb', 'gc', 'gd'].map((s) => one(out, s).outcome), ['hands-off', 'hands-off', 'bounced', 'hands-off'])
  assert.deepEqual(one(out, 'gb').acts.map((a) => [a.kind, a.counted]), [['signOff', false]])
  assert.deepEqual(one(out, 'gc').acts.map((a) => [a.kind, a.counted]), [['signOff', true]])
  assert.deepEqual(one(out, 'gd').notCounted, { standingApproval: 1, automaticHandBack: 0 })
  const ready = out.grades.window.byGrade.Ready
  assert.deepEqual([ready.handsOff, ready.bounced, ready.foreseenSignOffs, ready.byKind.signOff, ready.notCounted.standingApproval],
    [3, 1, 1, 2, 1])
})

test('a set-aside then an automatic retry then a merge is hands-off, with setAsides 1', (t) => {
  const h = setup(t)
  const L = line('r7')
  emitAll(h, [
    grade(h, 'sa', W(3, '00:00')),
    L(W(3, '01:00'), 'slot-taken', 'sa', SETTINGS),
    L(W(3, '02:00'), 'set-aside', 'sa', { stage: 'verify', reasonClass: 'transient', setAsideAt: 'run' }),
    L(W(3, '02:00'), 'slot-freed', 'sa', { outcome: 'set-aside' }),
    L(W(3, '02:10'), 'auto-retry', 'sa', { stage: 'verify', setAsideAt: 'run', retryClass: 'infra', used: 1, budget: 2 }),
    ...run('r7', 'sa', W(3, '03:00'), W(3, '04:00'), W(3, '05:00')),
  ])
  note(h, 'sa', { status: 'done' })
  const e = one(grades(h), 'sa')
  assert.deepEqual([e.outcome, e.setAsides, e.notCounted.automaticHandBack, e.acts], ['hands-off', 1, 1, []])
})

test('done with no record line: by hand when the link is unchanged, hands-off by link when it moved to a serial rollout', (t) => {
  const h = setup(t)
  emitAll(h, [
    grade(h, 'bh', W(3, '00:00'), { linked: 'old-rollout' }),
    grade(h, 'sr', W(3, '00:00'), { linked: 'old-rollout', shape: 'serial' }),
  ])
  note(h, 'bh', { status: 'done', rollout: 'old-rollout', completed: '2026-09-05' })
  note(h, 'sr', { status: 'done', rollout: 'Serial-Rollout-2026-09-04', completed: '2026-09-05' })
  const out = grades(h)
  assert.deepEqual(eps(out, 'bh'), [], 'by hand is a count alone')
  assert.deepEqual([one(out, 'sr').outcome, one(out, 'sr').dispatchedBy, one(out, 'sr').endLink, one(out, 'sr').rollouts],
    ['hands-off', 'link', 'serial-rollout-2026-09-04', ['serial-rollout-2026-09-04']])
  const ready = out.grades.window.byGrade.Ready
  assert.deepEqual([ready.byHand, ready.handsOff, ready.rate], [1, 1, 1])
})

test('window against all: an instant in or out of the window, and a date-only completed: on either boundary', (t) => {
  const h = setup(t)
  emitAll(h, [
    grade(h, 'w0', '2026-08-20T00:00:00Z'), ...run('r8', 'w0', '2026-08-21T00:00:00Z', '2026-08-21T01:00:00Z', '2026-08-25T00:00:00Z'),
    grade(h, 'w1', W(3, '00:00')), ...run('r8', 'w1', W(4, '00:00'), W(4, '01:00'), W(4, '02:00')),
    grade(h, 'w2', W(3, '00:00'), { linked: 'a' }), grade(h, 'w3', W(3, '00:00'), { linked: 'a' }),
  ].sort((x, y) => Date.parse(x[0]) - Date.parse(y[0])))
  note(h, 'w0', { status: 'done' })
  note(h, 'w1', { status: 'done' })
  note(h, 'w2', { status: 'done', rollout: 'b', completed: '2026-09-03' }) // since's Melbourne date: in
  note(h, 'w3', { status: 'done', rollout: 'b', completed: '2026-09-10' }) // until's Melbourne date: the next reading's
  const out = grades(h)
  assert.deepEqual(out.grades.episodes.map((e) => e.task).sort(), ['w1', 'w2'], 'episodes[] holds the window\'s closed ones')
  assert.deepEqual([out.grades.window.byGrade.Ready.handsOff, out.grades.all.byGrade.Ready.handsOff], [2, 4])
  assert.equal(out.grades.all.byGrade.Ready.episodes, 4)
})

test('a close after until is still open: an instant after it, or a date-only completed: or merged: after until\'s Melbourne date', (t) => {
  const h = setup(t)
  emitAll(h, ['dc', 'dm', 'di', 'du'].map((s) => grade(h, s, W(3, '00:00'), { linked: 'a' })))
  note(h, 'dc', { status: 'done', rollout: 'b', completed: '2026-09-11' }) // the day after until's date (2026-09-10)
  note(h, 'dm', { status: 'done', rollout: 'b', merged: '2026-09-11' })
  note(h, 'di', { status: 'done', rollout: 'b', merged: '2026-09-10T00:30+10:00' }) // 30 minutes after until
  note(h, 'du', { status: 'dropped', rollout: 'b', completed: '2026-09-10' }) // until's own date: closed, the next window's
  const out = grades(h)
  assert.deepEqual(out.grades.pending, { total: 3, byGrade: { Ready: 3, 'One call': 0, Grill: 0, Orient: 0 } })
  assert.deepEqual(out.grades.episodes, [], 'none closed in the window')
  const all = out.grades.all.byGrade.Ready
  assert.deepEqual([all.episodes, all.handsOff, all.dropped], [1, 0, 1], 'only the close on until\'s own date counts, in all')
  // The next reading, whose window holds those dates, reads them closed.
  const next = grades(h, { since: UNTIL, until: '2026-09-17T00:00+10:00' })
  assert.deepEqual(next.grades.episodes.map((e) => [e.task, e.outcome, e.end.date]).sort(),
    [['dc', 'hands-off', '2026-09-11'], ['di', 'hands-off', null], ['dm', 'hands-off', '2026-09-11'], ['du', 'dropped', '2026-09-10']])
  assert.equal(next.grades.pending.total, 0)
})

test('the regrade boundary is half-open: a record line at the next grade\'s ts is the next episode\'s', (t) => {
  const h = setup(t)
  emitAll(h, [
    grade(h, 'hb', W(3, '00:00')), ...run('r12', 'hb', W(3, '01:00'), W(3, '02:00')),
    line('r12')(W(4, '00:00'), 'answer-recorded', 'hb', { answerKind: 'decision' }),
    grade(h, 'hb', W(4, '00:00'), { grade: 'One call', decisions: 1 }),
    ...run('r13', 'hb', W(4, '01:00'), W(4, '02:00'), W(4, '03:00')),
  ].sort((x, y) => Date.parse(x[0]) - Date.parse(y[0])))
  note(h, 'hb', { status: 'done' })
  const [first, second] = eps(grades(h), 'hb')
  assert.deepEqual([first.grade, first.outcome, first.acts, first.end.at, first.rollouts],
    ['Ready', 'regraded', [], '2026-09-04T00:00:00.000Z', ['r12']])
  assert.deepEqual([second.grade, second.outcome, second.acts.map((a) => [a.kind, a.at]), second.rollouts],
    ['One call', 'bounced', [['answer', '2026-09-04T00:00:00.000Z']], ['r12', 'r13']])
})

test('open is pending, outside the rate; a missing note is unknown, in all only and flagged; a dateless close is flagged', (t) => {
  const h = setup(t)
  emitAll(h, [grade(h, 'op', W(3, '00:00')), grade(h, 'gone', W(3, '00:00')), grade(h, 'nd', W(3, '00:00'), { linked: 'x' })])
  note(h, 'op', { status: 'in_progress' })
  note(h, 'nd', { status: 'done', rollout: 'y' })
  const out = grades(h)
  assert.deepEqual(out.grades.episodes, [], 'pending, unknown and a dateless close are no episode of the window')
  assert.ok(out.flags.includes('[[gone]]: no task note: its latest grade (Ready) reads unknown'), JSON.stringify(out.flags))
  assert.ok(out.flags.some((f) => /^\[\[nd\]\] \(Ready, g-[^)]+\): closed landed with no merged: or completed: date: counted in all only$/.test(f)),
    JSON.stringify(out.flags))
  const all = out.grades.all.byGrade.Ready
  assert.deepEqual([all.unknown, all.handsOff, all.rate, out.grades.window.byGrade.Ready.episodes], [1, 1, 1, 0])
  assert.equal(out.grades.pending.total, 1)
  assert.ok(out.cannotShow.some((c) => c.includes('DECISION_MINUTES')), 'the gaps are named')
})

test('a titled note (p34-6): its grade line, keyed by title_key with the name as its note, finds the note again, root or Archive', (t) => {
  const h = setup(t)
  const DASHED = 'Layout broken — library panel stays open'
  const SPACED = 'Return the Adidas item'
  const GONE = 'Fix I rig stream'
  emitAll(h, [
    grade(h, 'layout-broken-library-panel-stays-open', W(3, '00:00'), { linked: 'old-rollout', note: DASHED }),
    grade(h, 'return-the-adidas-item', W(3, '00:00'), { linked: 'old-rollout', note: SPACED }),
    grade(h, 'fix-i-rig-stream', W(3, '00:00'), { note: GONE }),
  ])
  note(h, DASHED, { status: 'done', rollout: 'Serial-Rollout-2026-09-04', completed: '2026-09-05' })
  note(h, SPACED, { status: 'dropped', rollout: 'Serial-Rollout-2026-09-04', completed: '2026-09-06' })
  fs.renameSync(path.join(h.tasks, `${SPACED}.md`), path.join(h.tasks, 'Archive', '2026', `${SPACED}.md`))
  const out = grades(h)
  const dashed = one(out, 'layout-broken-library-panel-stays-open')
  assert.deepEqual([dashed.note, dashed.outcome, dashed.dispatchedBy, dashed.end.by], [DASHED, 'hands-off', 'link', 'note'])
  const spaced = one(out, 'return-the-adidas-item')
  assert.deepEqual([spaced.note, spaced.outcome, spaced.end.date], [SPACED, 'dropped', '2026-09-06'])
  assert.ok(out.flags.includes(`[[${GONE}]]: no task note: its latest grade (Ready) reads unknown`), JSON.stringify(out.flags))
  assert.equal(out.grades.all.byGrade.Ready.unknown, 1)
})

test('a titled note renamed to its key (p34-6): only the latest grade line names the note, and a gone name is tried as the task', (t) => {
  const h = setup(t)
  // Renamed before its latest grade: the older line's note is not used, so the note is found at its key.
  const RENAMED = 'Order the Brace'
  // Renamed after its latest grade: that line's note is gone, so the note is looked up by the task.
  const LATER = 'Tune the Rig'
  emitAll(h, [
    grade(h, 'order-the-brace', W(3, '00:00'), { linked: 'old-rollout', note: RENAMED }),
    grade(h, 'order-the-brace', W(4, '00:00'), { linked: 'old-rollout' }),
    grade(h, 'tune-the-rig', W(3, '00:00'), { linked: 'old-rollout', note: LATER }),
  ])
  note(h, 'order-the-brace', { status: 'done', rollout: 'Serial-Rollout-2026-09-04', completed: '2026-09-05' })
  note(h, 'tune-the-rig', { status: 'dropped', rollout: 'Serial-Rollout-2026-09-04', completed: '2026-09-06' })
  const out = grades(h)
  const renamed = one(out, 'order-the-brace')
  assert.deepEqual([renamed.note, renamed.outcome, renamed.dispatchedBy, renamed.end.date], [undefined, 'hands-off', 'link', '2026-09-05'])
  const later = one(out, 'tune-the-rig')
  assert.deepEqual([later.note, later.outcome, later.end.date], [undefined, 'dropped', '2026-09-06'])
  assert.deepEqual(out.flags.filter((f) => /brace|rig/i.test(f)), [], 'neither reads unknown')
  assert.equal(out.grades.all.byGrade.Ready.unknown, 0)
})

test('byAgentGrade sets a confidence-raised task apart from its raised grade', (t) => {
  const h = setup(t)
  emitAll(h, [grade(h, 'rz', W(3, '00:00'), { grade: 'One call', agentGrade: 'Ready', decisions: 1, low: 1, raised: ['confidence'] }),
    ...run('r9', 'rz', W(3, '01:00'), W(3, '02:00'), W(3, '03:00'))])
  note(h, 'rz', { status: 'done' })
  const out = grades(h)
  assert.deepEqual(one(out, 'rz').raised, ['confidence'])
  assert.deepEqual([out.grades.window.byGrade['One call'].handsOff, out.grades.window.byGrade.Ready.episodes,
    out.grades.window.byAgentGrade.Ready.handsOff, out.grades.window.byAgentGrade['One call'].episodes], [1, 0, 1, 0])
})

test('a bounce on a merge hold alone counts in mergeHoldOnly', (t) => {
  const h = setup(t)
  const L = line('r10')
  emitAll(h, [grade(h, 'mh', W(3, '00:00')), ...run('r10', 'mh', W(3, '01:00'), W(3, '02:00')),
    L(W(3, '02:00'), 'ready', 'mh', { pr: 7 }), L(W(3, '02:05'), 'lane-taken', 'mh'),
    L(W(3, '02:10'), 'hold-started', 'mh', { hold: 'merge' }), L(W(3, '04:00'), 'lane-freed', 'mh', { release: 'merge' }),
    L(W(3, '04:00'), 'merged', 'mh', { pr: 7 })])
  note(h, 'mh', { status: 'done' })
  const out = grades(h)
  assert.deepEqual([one(out, 'mh').outcome, one(out, 'mh').acts.map((a) => a.kind)], ['bounced', ['mergeHold']])
  assert.deepEqual([out.grades.window.byGrade.Ready.mergeHoldOnly, out.grades.window.byGrade.Ready.byKind.mergeHold], [1, 1])
})

test('bySize: a 45-minute Slot and a 10-minute lane against the S estimate; a serial landing is untimed', (t) => {
  const h = setup(t)
  const L = line('r11')
  emitAll(h, [grade(h, 'sz', W(3, '00:00')), L(W(3, '01:00'), 'slot-taken', 'sz', SETTINGS), L(W(3, '01:45'), 'slot-freed', 'sz', { outcome: 'ready' }),
    L(W(3, '01:45'), 'ready', 'sz', { pr: 7 }), L(W(3, '01:50'), 'lane-taken', 'sz'), L(W(3, '02:00'), 'lane-freed', 'sz', { release: 'merge' }),
    L(W(3, '02:00'), 'merged', 'sz', { pr: 7 }), grade(h, 'ser', W(3, '00:00'), { shape: 'serial', linked: 'old' })])
  note(h, 'sz', { status: 'done' })
  note(h, 'ser', { status: 'done', rollout: 'chain-rollout', completed: '2026-09-05' })
  const out = grades(h)
  assert.deepEqual([one(out, 'sz').slotHours, one(out, 'sz').laneHours, one(out, 'ser').slotHours], [0.75, 0.167, null])
  assert.deepEqual(out.grades.window.bySize.S, { timed: 1, untimed: 1, slotHours: { median: 0.75, mean: 0.75 },
    laneHours: { median: 0.167, mean: 0.167 }, estimateHours: 0.5 })
  assert.deepEqual([out.grades.window.bySize.M.estimateHours, out.grades.window.bySize.L.timed], [2, 0])
})
